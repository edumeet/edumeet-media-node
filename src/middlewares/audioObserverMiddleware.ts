import { Logger, Middleware } from 'edumeet-common';
import { MiddlewareOptions } from '../common/types';
import { RouterData } from '../MediaService';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('AudioObserverMiddleware');

export const createAudioObserverMiddleware = ({
	roomServer,
}: MiddlewareOptions): Middleware<RoomServerConnectionContext> => {
	logger.debug('createAudioObserverMiddleware()');

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
			case 'createActiveSpeakerObserver': {
				const {
					routerId,
					interval,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const activeSpeakerObserver = await router.createActiveSpeakerObserver({
					interval
				});

				routerData.activeSpeakerObservers.set(activeSpeakerObserver.id, activeSpeakerObserver);
				activeSpeakerObserver.observer.once('close', () => {
					routerData.activeSpeakerObservers.delete(activeSpeakerObserver.id);

					if (!activeSpeakerObserver.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'activeSpeakerObserverClosed',
							data: {
								routerId,
								activeSpeakerObserverId: activeSpeakerObserver.id
							}
						});
					}
				});

				activeSpeakerObserver.observer.on('dominantspeaker', ({ producer: { id: dominantSpeakerId } }) => {
					roomServerConnection.notify({
						method: 'activeSpeakerObserverDominantSpeaker',
						data: {
							routerId,
							activeSpeakerObserverId: activeSpeakerObserver.id,
							dominantSpeakerId
						}
					});
				});

				response.id = activeSpeakerObserver.id;
				context.handled = true;

				break;
			}

			case 'activeSpeakerObserverAddProducer': {
				const {
					routerId,
					activeSpeakerObserverId,
					producerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const activeSpeakerObserver = routerData.activeSpeakerObservers.get(activeSpeakerObserverId);

				if (!activeSpeakerObserver)
					throw new Error(`activeSpeakerObserver with id "${activeSpeakerObserverId}" not found`);

				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await activeSpeakerObserver.addProducer({ producerId });
				context.handled = true;

				break;
			}

			case 'activeSpeakerObserverRemoveProducer': {
				const {
					routerId,
					activeSpeakerObserverId,
					producerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const activeSpeakerObserver = routerData.activeSpeakerObservers.get(activeSpeakerObserverId);

				if (!activeSpeakerObserver)
					throw new Error(`activeSpeakerObserver with id "${activeSpeakerObserverId}" not found`);

				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await activeSpeakerObserver.removeProducer({ producerId });
				context.handled = true;

				break;
			}

			case 'closeActiveSpeakerObserver': {
				const {
					routerId,
					activeSpeakerObserverId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const activeSpeakerObserver = routerData.activeSpeakerObservers.get(activeSpeakerObserverId);

				if (!activeSpeakerObserver)
					throw new Error(`activeSpeakerObserver with id "${activeSpeakerObserverId}" not found`);

				activeSpeakerObserver.appData.remoteClosed = true;
				activeSpeakerObserver.close();
				context.handled = true;

				break;
			}

			case 'createAudioLevelObserver': {
				const {
					routerId,
					interval,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const audioLevelObserver = await router.createAudioLevelObserver({
					interval
				});

				routerData.audioLevelObservers.set(audioLevelObserver.id, audioLevelObserver);
				audioLevelObserver.observer.once('close', () => {
					routerData.audioLevelObservers.delete(audioLevelObserver.id);

					if (!audioLevelObserver.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'audioLevelObserverClosed',
							data: {
								routerId,
								audioLevelObserverId: audioLevelObserver.id
							}
						});
					}
				});

				audioLevelObserver.observer.on('volumes', (volumes) => {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const audioLevels = volumes.map((volume: { producer: { id: any; }; volume: any; }) => {
						return {
							producerId: volume.producer.id,
							volume: volume.volume
						};
					});

					roomServerConnection.notify({
						method: 'audioLevelObserverVolumes',
						data: {
							routerId,
							audioLevelObserverId: audioLevelObserver.id,
							audioLevels
						}
					});
				});

				response.id = audioLevelObserver.id;
				context.handled = true;

				break;
			}

			case 'audioLevelObserverAddProducer': {
				const {
					routerId,
					audioLevelObserverId,
					producerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const audioLevelObserver = routerData.audioLevelObservers.get(audioLevelObserverId);

				if (!audioLevelObserver)
					throw new Error(`audioLevelObserver with id "${audioLevelObserverId}" not found`);

				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await audioLevelObserver.addProducer({ producerId });
				context.handled = true;

				break;
			}

			case 'audioLevelObserverRemoveProducer': {
				const {
					routerId,
					audioLevelObserverId,
					producerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const audioLevelObserver = routerData.audioLevelObservers.get(audioLevelObserverId);

				if (!audioLevelObserver)
					throw new Error(`audioLevelObserver with id "${audioLevelObserverId}" not found`);

				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await audioLevelObserver.removeProducer({ producerId });
				context.handled = true;

				break;
			}

			case 'closeAudioLevelObserver': {
				const {
					routerId,
					audioLevelObserverId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const audioLevelObserver = routerData.audioLevelObservers.get(audioLevelObserverId);

				if (!audioLevelObserver)
					throw new Error(`audioLevelObserver with id "${audioLevelObserverId}" not found`);

				audioLevelObserver.appData.remoteClosed = true;
				audioLevelObserver.close();
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