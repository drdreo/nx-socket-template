import { Logger } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway, WsException, OnGatewayDisconnect, WsResponse, WebSocketServer, ConnectedSocket, OnGatewayConnection, MessageBody } from '@nestjs/websockets';
import { SocketEvent, UserEvent, ServerJoined, HomeInfo, UserVoteKickMessage, UserJoinMessage } from '@socket-template-app/api-interfaces';
import { Server, Socket } from 'socket.io';
import { RoomService } from './room.service';
import { InvalidConfigError, RoomFullError, RoomStartedError } from './room/errors';
import { User } from './user/User';

const SOCKET_USER_ID_TOKEN = 'user-id';
const SOCKET_ROOM_TOKEN = 'room';

// @UseInterceptors(SentryInterceptor)
@WebSocketGateway({ cors: true })
export class MainGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;

    private logger = new Logger(MainGateway.name);

    constructor(private roomService: RoomService) {
        this.logger.verbose('Created');
    }

    handleConnection(socket: Socket) {
        this.logger.debug(`A new socket{${ socket.id }} connected!`);
    }

    handleDisconnect(socket: Socket) {
        this.logger.debug(`A socket{${ socket.id }} disconnected!`);

        this.handleUserDisconnect(socket[SOCKET_USER_ID_TOKEN], socket[SOCKET_ROOM_TOKEN]);
    }

    @SubscribeMessage(UserEvent.JoinRoom)
    onJoinRoom(@ConnectedSocket() socket: Socket, @MessageBody() { userID, roomName, userName }: UserJoinMessage): WsResponse<ServerJoined> {
        this.logger.log(`User[${ userName }] joining!`);
        let sanitizedRoom = roomName.toLowerCase();
        socket.join(sanitizedRoom);
        socket[SOCKET_ROOM_TOKEN] = sanitizedRoom;
        socket[SOCKET_USER_ID_TOKEN] = userID; // either overwrite existing one, reset it if its undefined

        let newUserID;

        // existing user needs to reconnect
        if (userID && this.roomService.userExists(userID)) {
            this.logger.log(`User[${ userName }] needs to reconnect!`);
            newUserID = userID;
            const room = this.roomService.userReconnected(userID);
            this.logger.debug(`Users last room[${ room.name }] found!`);

            if (room.name !== sanitizedRoom) {
                this.logger.warn(
                    `User tried to join other room than they were playing on!`
                );
                // leave the passed room and join old one again
                socket.leave(sanitizedRoom);
                sanitizedRoom = room.name;
                socket.join(sanitizedRoom);
                socket[SOCKET_ROOM_TOKEN] = sanitizedRoom;
            }
        } else if (userName) {
            // new User wants to create or join
            this.logger.debug(`New User[${ userName }] wants to create or join [${ sanitizedRoom }]!`);
            try {
                const response = this.roomService.createOrJoinRoom(sanitizedRoom, userName);
                newUserID = response.userID;
                this.sendHomeInfo();
            } catch (e) {
                if (e instanceof InvalidConfigError) {
                    throw new WsException('Invalid config provided!');
                }

                const room = this.roomService.getRoom(sanitizedRoom);
                if (e instanceof RoomStartedError || e instanceof RoomFullError) {
                    if (room && room.getConfig().spectatorsAllowed) {
                        this.logger.debug('Couldnt create or join room, join as spectator!');
                        this.onJoinSpectator(socket, { roomName });
                        return {
                            event: SocketEvent.Joined,
                            data: { userID: userID, room: sanitizedRoom }
                        };
                    } else {
                        this.logger.debug('Couldnt create or join room, but spectating is not allowed!');
                        this.disconnectSocket(socket, sanitizedRoom);
                        throw new WsException('Spectating is not allowed!');
                    }
                } else {
                    console.error(e);
                }
            }
        } else {
            // Spectator joining
            throw new Error('Spectator should not be able to join this way!');
        }

        // connect the socket with its userID
        socket[SOCKET_USER_ID_TOKEN] = newUserID;
        socket[SOCKET_ROOM_TOKEN] = sanitizedRoom;

        // inform everyone that someone joined
        this.roomService.getRoom(sanitizedRoom).sendUsersUpdate();
        return {
            event: SocketEvent.Joined,
            data: { userID: newUserID, room: sanitizedRoom }
        };
    }

    @SubscribeMessage(UserEvent.SpectatorJoin)
    onJoinSpectator(@ConnectedSocket() socket: Socket, @MessageBody() { roomName }) {
        const sanitizedRoom = roomName.toLowerCase();
        this.logger.log(`Spectator trying to join room[${ sanitizedRoom }]!`);
        const room = this.roomService.getRoom(sanitizedRoom);

        if (room && room.getConfig().spectatorsAllowed) {
            socket.join(sanitizedRoom);
            socket[SOCKET_ROOM_TOKEN] = sanitizedRoom;

            // tell the spectator all information if game started: users, game status, board, pot
            this.onRequestUpdate(socket);

            return { event: SocketEvent.Joined, data: { room: sanitizedRoom } };
        } else {
            throw new WsException('Spectating is not allowed!');
        }
    }

    @SubscribeMessage(UserEvent.RequestUpdate)
    onRequestUpdate(@ConnectedSocket() socket: Socket) {
        const room = this.roomService.getRoom(socket[SOCKET_ROOM_TOKEN]);
        if (!room) {
            throw new WsException('Can not request data. Room not found!');
        }

        room.sendUsersUpdate(socket.id);
    }

    @SubscribeMessage(UserEvent.Start)
    onStartGame(@ConnectedSocket() socket: Socket) {
        const room = socket[SOCKET_ROOM_TOKEN];
        this.roomService.start(room);
        this.sendHomeInfo();
    }

    @SubscribeMessage(UserEvent.Leave)
    onUserLeave(@ConnectedSocket() socket: Socket) {
        const userID = socket[SOCKET_USER_ID_TOKEN];
        const room = socket[SOCKET_ROOM_TOKEN];
        this.handleUserDisconnect(userID, room);
    }

    @SubscribeMessage(UserEvent.VoteKick)
    onVoteKick(@ConnectedSocket() socket: Socket, @MessageBody() { kickUserID }: UserVoteKickMessage) {
        const userID = socket[SOCKET_USER_ID_TOKEN];
        const room = socket[SOCKET_ROOM_TOKEN];
        this.roomService.voteKick(room, userID, kickUserID);
    }

    private sendTo(recipient: string, event: SocketEvent, data?: any) {
        this.server.to(recipient).emit(event, data);
    }

    private sendToAll(event: SocketEvent, data?: any) {
        this.server.emit(event, data);
    }

    private async getSocketIdByUserId(userId: string) {
        const sockets = await this.server.fetchSockets();
        return sockets.find((socket) => socket[SOCKET_USER_ID_TOKEN] === userId)?.id;
    }

    private async getUserIdBySocketId(socketId: string) {
        const sockets = await this.server.fetchSockets();
        const socket = sockets.find((socket) => socket.id === socketId);

        if (socket) {
            return socket[SOCKET_USER_ID_TOKEN];
        }
        return undefined;
    }

    /**
     * Called when a socket disconnects or a user opens the home page (to tell the server that a user navigated away from the room)
     * @param userID
     * @param room
     */
    private handleUserDisconnect(userID: string | undefined, room: string | undefined) {
        if (!userID) {
            console.error('UserID not patched. Very weird!');
        }

        if (userID && this.roomService.userExists(userID)) {
            this.logger.debug(`User[${ userID }] left!`);
            this.roomService.userLeft(room, userID);

            if (room) {
                this.sendTo(room, SocketEvent.UserLeft, { userID });
            } else {
                this.logger.error(`User[${ userID }] disconnected or left, but room[${ room }] no longer exists!`);
            }
        }
    }

    // to prevent sockets from still receiving game messages. Leaves the room and unsets all socket data
    private disconnectSocket(socket: any, room: string) {
        socket.leave(room);
        socket[SOCKET_ROOM_TOKEN] = undefined;
        socket[SOCKET_USER_ID_TOKEN] = null;
    }

    private async sendUserUpdateIndividually(room: string, users: User[], data: any) {
        for (const user of users) {
            const socketId = await this.getSocketIdByUserId(user.id);
            // only tell currently connected users the update
            if (socketId && !user.disconnected) {
                this.sendTo(socketId, SocketEvent.UsersUpdate, data);
            }
        }
    }

    private async sendUsersUpdateToSpectators(roomName: string, data: any) {
        const room = this.roomService.getRoom(roomName);
        const socketsOfRoom = await this.server.in(roomName).fetchSockets();

        for (const socket of socketsOfRoom) {
            const isSpectator = room.isSpectator(socket[SOCKET_USER_ID_TOKEN]);
            if (isSpectator) {
                this.sendTo(roomName, SocketEvent.UsersUpdate, data);
            }
        }
    }

    private sendHomeInfo() {
        const response: HomeInfo = {
            rooms: this.roomService.getAllRooms(),
            userCount: this.roomService.getUserCount()
        };
        this.sendToAll(SocketEvent.Info, response);
    }
}
