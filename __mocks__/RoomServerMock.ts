import { EventEmitter } from 'events';
import { Router } from 'mediasoup/types';

export default class RoomServerMock extends EventEmitter {
	routers = new Map<string, Router>();
}