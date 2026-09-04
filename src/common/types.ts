import MediaService from '../MediaService';
import RoomServer from '../RoomServer';
import { ObserverService } from '../ObserverService';

export interface MiddlewareOptions {
	roomServer: RoomServer;
	mediaService: MediaService;
	observerService: ObserverService;
}