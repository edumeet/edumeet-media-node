import { Logger, Middleware } from 'edumeet-common';
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
			connectionId,
			message,
			response
		} = context;

		switch (message.method) {
			case 'getRouter': {
				const router = await mediaService.getRouter(roomServerConnection.roomId);

				// This could be a new router, but it could also be an existing one.
				if (!roomServer.routers.has(router.id)) {
					roomServer.routers.set(router.id, router);

					// Notify any other room servers that might be connected
					roomServerConnection.notify({
						method: 'newRouter',
						data: {
							routerId: router.id,
							rtpCapabilities: router.rtpCapabilities
						}
					}, connectionId);
				}

				router.observer.on('close', () => {
					roomServer.routers.delete(router.id);

					if (!router.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'routerClosed',
							data: {
								routerId: router.id
							}
						}, router.appData.remoteClosedBy as string);
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
				router.appData.remoteClosedBy = connectionId;
				router.close();
				context.handled = true;

				break;
			}

			case 'canConsume': {
				const {
					routerId,
					producerId,
					rtpCapabilities
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const canConsume = router.canConsume({
					producerId,
					rtpCapabilities
				});

				response.canConsume = canConsume;
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