import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { RouterData } from '../MediaService';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('ProducerMiddleware');

interface ProducerData {
	remoteClosed?: boolean;
}

export const createProducerMiddleware = ({
	roomServer,
}: MiddlewareOptions): Middleware<RoomServerConnectionContext> => {
	logger.debug('createProducerMiddleware()');

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
			case 'createPipeProducer': {
				const {
					routerId,
					pipeTransportId,
					producerId,
					kind,
					rtpParameters,
					paused,
					appData: clientData
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const pipeTransport = routerData.pipeTransports.get(pipeTransportId);

				if (!pipeTransport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				const pipeProducer = await pipeTransport.produce({
					id: producerId,
					kind,
					rtpParameters,
					paused,
					appData: {
						clientData,
						serverData: {} as ProducerData
					}
				});

				routerData.pipeProducers.set(pipeProducer.id, pipeProducer);

				pipeProducer.observer.once('close', () => {
					routerData.pipeProducers.delete(pipeProducer.id);

					if (!pipeProducer.appData.serverData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeProducerClosed',
							data: {
								routerId,
								pipeProducerId: pipeProducer.id
							}
						});
					}
				});

				response.id = pipeProducer.id;
				context.handled = true;

				break;
			}

			case 'closePipeProducer': {
				const {
					routerId,
					pipeProducerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const pipeProducer = routerData.pipeProducers.get(pipeProducerId);

				if (!pipeProducer)
					throw new Error(`pipeProducer with id "${pipeProducerId}" not found`);

				const pipeProducerData = pipeProducer.appData.serverData as ProducerData;

				pipeProducerData.remoteClosed = true;
				pipeProducer.close();
				context.handled = true;

				break;
			}

			case 'pausePipeProducer': {
				const {
					routerId,
					pipeProducerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const pipeProducer = routerData.pipeProducers.get(pipeProducerId);

				if (!pipeProducer)
					throw new Error(`pipeProducer with id "${pipeProducerId}" not found`);

				await pipeProducer.pause();
				context.handled = true;

				break;
			}

			case 'resumePipeProducer': {
				const {
					routerId,
					pipeProducerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const pipeProducer = routerData.pipeProducers.get(pipeProducerId);

				if (!pipeProducer)
					throw new Error(`pipeProducer with id "${pipeProducerId}" not found`);

				await pipeProducer.resume();
				context.handled = true;

				break;
			}

			case 'produce': {
				const {
					routerId,
					transportId,
					kind,
					rtpParameters,
					paused,
					appData: clientData
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const transport = routerData.webRtcTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				try {
					const producer = await transport.produce({
						kind,
						rtpParameters,
						paused,
						appData: {
							clientData,
							serverData: {} as ProducerData
						}
					});

					routerData.producers.set(producer.id, producer);
					producer.observer.once('close', () => {
						routerData.producers.delete(producer.id);

						if (!producer.appData.serverData.remoteClosed) {
							roomServerConnection.notify({
								method: 'producerClosed',
								data: {
									routerId,
									producerId: producer.id
								}
							});
						}
					});

					producer.on('score', (score) => roomServerConnection.notify({
						method: 'producerScore',
						data: {
							routerId,
							producerId: producer.id,
							score
						}
					}));

					response.id = producer.id;
					context.handled = true;
				} catch (error) {
					throw new Error('produce failed');
				}

				break;
			}

			case 'closeProducer': {
				const { routerId, producerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);
				
				const producerData = producer.appData.serverData as ProducerData;

				producerData.remoteClosed = true;
				producer.close();
				context.handled = true;

				break;
			}

			case 'pauseProducer': {
				const { routerId, producerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await producer.pause();
				context.handled = true;

				break;
			}

			case 'resumeProducer': {
				const { routerId, producerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData.serverData as RouterData;
				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await producer.resume();
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