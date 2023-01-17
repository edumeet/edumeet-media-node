import { EventEmitter } from 'events';
import { Router } from 'mediasoup/node/lib/Router';

export default class RoomServerMock extends EventEmitter {
	routers = new Map<string, Router>();
}