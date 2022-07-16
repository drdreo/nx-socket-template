import { Component } from '@angular/core';
import { SocketService } from '@socket-template-app/nx-socket-template/data-access';

@Component({
    selector: 'socket-template-app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent {
    constructor(private socketService: SocketService) {}

    join(userName: string, roomName: string): void {
        this.socketService.join(userName, roomName);
    }

    start(): void {
        this.socketService.start();
    }

    kick(): void {
        this.socketService.voteKick('123');
    }
}
