import MediaService from '../MediaService';
import RoomServer from '../RoomServer';

export interface MiddlewareOptions {
	roomServer: RoomServer;
	mediaService: MediaService;
}