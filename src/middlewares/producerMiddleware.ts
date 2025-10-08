import { Logger, Middleware } from 'edumeet-common';
import { MiddlewareOptions } from '../common/types';
import { RouterData } from '../MediaService';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('ProducerMiddleware');

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
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeTransport = routerData.pipeTransports.get(pipeTransportId);

				if (!pipeTransport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				const pipeProducer = await pipeTransport.produce({
					id: producerId,
					kind,
					rtpParameters,
					paused,
				});

				routerData.pipeProducers.set(pipeProducer.id, pipeProducer);
				pipeProducer.observer.once('close', () => {
					routerData.pipeProducers.delete(pipeProducer.id);

					if (!pipeProducer.appData.remoteClosed) {
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

				const routerData = router.appData as unknown as RouterData;
				const pipeProducer = routerData.pipeProducers.get(pipeProducerId);

				if (!pipeProducer)
					throw new Error(`pipeProducer with id "${pipeProducerId}" not found`);

				pipeProducer.appData.remoteClosed = true;
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

				const routerData = router.appData as unknown as RouterData;
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

				const routerData = router.appData as unknown as RouterData;
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
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId) || 
					routerData.plainTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				const producer = await transport.produce({
					kind,
					rtpParameters,
					paused,
				});

				routerData.producers.set(producer.id, producer);
				producer.observer.once('close', () => {
					routerData.producers.delete(producer.id);

					if (!producer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'producerClosed',
							data: {
								routerId,
								producerId: producer.id
							}
						});
					}
				});

				// producer.on('score', (score) => roomServerConnection.notify({
				// 	method: 'producerScore',
				// 	data: {
				// 		routerId,
				// 		producerId: producer.id,
				// 		score
				// 	}
				// }));

				response.id = producer.id;
				context.handled = true;

				break;
			}

			case 'closeProducer': {
				const { routerId, producerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				producer.appData.remoteClosed = true;
				producer.close();
				context.handled = true;

				break;
			}

			case 'pauseProducer': {
				const { routerId, producerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
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

				const routerData = router.appData as unknown as RouterData;
				const producer = routerData.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await producer.resume();
				context.handled = true;

				break;
			}

			case 'createPipeDataProducer': {
				const {
					routerId,
					pipeTransportId,
					dataProducerId,
					sctpStreamParameters,
					label,
					protocol,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeTransport = routerData.pipeTransports.get(pipeTransportId);

				if (!pipeTransport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				const pipeDataProducer = await pipeTransport.produceData({
					id: dataProducerId,
					sctpStreamParameters,
					label,
					protocol,
				});

				routerData.pipeDataProducers.set(pipeDataProducer.id, pipeDataProducer);
				pipeDataProducer.observer.once('close', () => {
					routerData.pipeDataProducers.delete(pipeDataProducer.id);

					if (!pipeDataProducer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeDataProducerClosed',
							data: {
								routerId,
								pipeDataProducerId: pipeDataProducer.id
							}
						});
					}
				});

				response.id = pipeDataProducer.id;
				context.handled = true;

				break;
			}

			case 'closePipeDataProducer': {
				const { routerId, pipeDataProducerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeDataProducer = routerData.pipeDataProducers.get(pipeDataProducerId);

				if (!pipeDataProducer)
					throw new Error(`pipeDataProducer with id "${pipeDataProducerId}" not found`);

				pipeDataProducer.appData.remoteClosed = true;
				pipeDataProducer.close();
				context.handled = true;

				break;
			}

			case 'produceData': {
				const {
					routerId,
					transportId,
					sctpStreamParameters,
					label,
					protocol,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId) || 
					routerData.plainTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				try {
					const dataProducer = await transport.produceData({
						sctpStreamParameters,
						label,
						protocol,
					});

					routerData.dataProducers.set(dataProducer.id, dataProducer);
					dataProducer.observer.once('close', () => {
						routerData.dataProducers.delete(dataProducer.id);

						if (!dataProducer.appData.remoteClosed) {
							roomServerConnection.notify({
								method: 'dataProducerClosed',
								data: {
									routerId,
									dataProducerId: dataProducer.id
								}
							});
						}
					});

					response.id = dataProducer.id;
					context.handled = true;
				} catch (error) {
					throw new Error('produceData failed');
				}

				break;
			}

			case 'closeDataProducer': {
				const { routerId, dataProducerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const dataProducer = routerData.dataProducers.get(dataProducerId);

				if (!dataProducer)
					throw new Error(`dataProducer with id "${dataProducerId}" not found`);

				dataProducer.appData.remoteClosed = true;
				dataProducer.close();
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
