import { Injectable } from '@angular/core';
import { UserEvent, UserVoteKickMessage, UserJoinMessage } from '@socket-template-app/api-interfaces';
import { Socket } from 'ngx-socket-io';
import { map, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class SocketService {

    constructor(private socket: Socket) {}

    sendMessage(msg: string): void {
        this.socket.emit('message', msg);
    }

    getMessage(): Observable<any> {
        return this.socket.fromEvent<any>('message').pipe(map((data) => data.msg));
    }

    join(userName: string, roomName: string) {
        this.socket.emit(UserEvent.JoinRoom, { userName, roomName } as UserJoinMessage);
    }

    start() {
        this.socket.emit(UserEvent.Start);
    }

    voteKick(userID: string) {
        this.socket.emit(UserEvent.VoteKick, { kickUserID: userID } as UserVoteKickMessage);
    }
}
