import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('RouterMiddleware');

export const createRouterMiddleware = ({
	roomServer,
	mediaService,
}: MiddlewareOptions): Middleware<RoomServerConnectionContext> => {
	logger.debug('createRouterMiddleware()');

	const middleware: Middleware<RoomServerConnectionContext> = async (
		context,
		next
	) => {
		const {
			roomServerConnection,
			message,
			response
		} = context;

		switch (message.method) {
			case 'getRouter': {
				const { roomId } = message.data;
				const router = await mediaService.getRouter(roomId);

				// This could be a new router, but it could also be an existing one.
				if (!roomServer.routers.has(router.id))
					roomServer.routers.set(router.id, router);

				router.observer.on('close', () => {
					roomServer.routers.delete(router.id);

					if (!router.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'routerClosed',
							data: {
								routerId: router.id
							}
						});
					}
				});

				response.id = router.id;
				response.rtpCapabilities = router.rtpCapabilities;
				context.handled = true;

				break;
			}

			case 'closeRouter': {
				const { routerId } = message.data;
				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				router.appData.remoteClosed = true;
				router.close();
				context.handled = true;

				break;
			}

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};