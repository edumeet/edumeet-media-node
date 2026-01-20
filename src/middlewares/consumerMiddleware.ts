import { Logger, Middleware } from 'edumeet-common';
import { MiddlewareOptions } from '../common/types';
import { RouterData } from '../MediaService';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('ConsumerMiddleware');

export const createConsumerMiddleware = ({
	roomServer,
}: MiddlewareOptions): Middleware<RoomServerConnectionContext> => {
	logger.debug('createConsumerMiddleware()');

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
			case 'createPipeConsumer': {
				const {
					routerId,
					pipeTransportId,
					producerId,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeTransport = routerData.pipeTransports.get(pipeTransportId);

				if (!pipeTransport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				const producer =
					routerData.producers.get(producerId) ??
					routerData.pipeProducers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				const pipeConsumer = await pipeTransport.consume({
					producerId: producer.id
				});

				routerData.pipeConsumers.set(pipeConsumer.id, pipeConsumer);
				pipeConsumer.observer.once('close', () => {
					routerData.pipeConsumers.delete(pipeConsumer.id);

					if (!pipeConsumer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeConsumerClosed',
							data: {
								routerId,
								pipeConsumerId: pipeConsumer.id
							}
						});
					}
				});

				pipeConsumer.observer.on('pause', () => {
					roomServerConnection.notify({
						method: 'pipeConsumerPaused',
						data: {
							routerId,
							pipeConsumerId: pipeConsumer.id
						}
					});
				});

				pipeConsumer.observer.on('resume', () => {
					roomServerConnection.notify({
						method: 'pipeConsumerResumed',
						data: {
							routerId,
							pipeConsumerId: pipeConsumer.id
						}
					});
				});

				response.id = pipeConsumer.id;
				response.kind = pipeConsumer.kind;
				response.producerPaused = pipeConsumer.producerPaused;
				response.rtpParameters = pipeConsumer.rtpParameters;
				context.handled = true;

				break;
			}

			case 'closePipeConsumer': {
				const {
					routerId,
					pipeConsumerId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeConsumer = routerData.pipeConsumers.get(pipeConsumerId);

				if (!pipeConsumer)
					throw new Error(`pipeConsumer with id "${pipeConsumerId}" not found`);

				pipeConsumer.appData.remoteClosed = true;
				pipeConsumer.close();
				context.handled = true;

				break;
			}

			case 'consume': {
				const {
					routerId,
					transportId,
					producerId,
					rtpCapabilities,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId) || 
					routerData.plainTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				const producer =
					routerData.producers.get(producerId) ??
					routerData.pipeProducers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				const consumer = await transport.consume({
					producerId: producer.id,
					rtpCapabilities,
					paused: producer.kind === 'video',
				});

				routerData.consumers.set(consumer.id, consumer);
				consumer.observer.once('close', () => {
					routerData.consumers.delete(consumer.id);

					if (!consumer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'consumerClosed',
							data: {
								routerId,
								consumerId: consumer.id
							}
						});
					}
				});
		
				consumer.on('producerpause', () => roomServerConnection.notify({
					method: 'consumerProducerPaused',
					data: {
						routerId,
						consumerId: consumer.id
					}
				}));
		
				consumer.on('producerresume', () => roomServerConnection.notify({
					method: 'consumerProducerResumed',
					data: {
						routerId,
						consumerId: consumer.id
					}
				}));
		
				// 	consumer.on('score', (score) => roomServerConnection.notify({
				// 		method: 'consumerScore',
				// 		data: {
				// 			routerId,
				// 			consumerId: consumer.id,
				// 			score
				// 		}
				// 	}));
				// 
				// 	consumer.on('layerschange', (layers) => {
				// 		if (!layers) logger.warn('layerschange event with null layers');
				// 		roomServerConnection.notify({
				// 			method: 'consumerLayersChanged',
				// 			data: {
				// 				routerId,
				// 				consumerId: consumer.id,
				// 				layers
				// 			}
				// 		}); 
				// 	});

				response.id = consumer.id;
				response.kind = consumer.kind;
				response.paused = consumer.paused;
				response.producerPaused = consumer.producerPaused;
				response.rtpParameters = consumer.rtpParameters;
				context.handled = true;

				break;
			}

			case 'closeConsumer': {
				const { routerId, consumerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const consumer = routerData.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				consumer.appData.remoteClosed = true;
				consumer.close();
				context.handled = true;

				break;
			}

			case 'pauseConsumer': {
				const { routerId, consumerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const consumer = routerData.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.pause();
				context.handled = true;

				break;
			}

			case 'resumeConsumer': {
				const { routerId, consumerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const consumer = routerData.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.resume();
				context.handled = true;

				break;
			}

			case 'setConsumerPreferredLayers': {
				const { routerId, consumerId, spatialLayer, temporalLayer } = message.data;
				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const consumer = routerData.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.setPreferredLayers({ spatialLayer, temporalLayer });
				context.handled = true;

				break;
			}

			case 'setConsumerPriority': {
				const { routerId, consumerId, priority } = message.data;
				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const consumer = routerData.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.setPriority(priority);
				context.handled = true;

				break;
			}

			case 'requestConsumerKeyFrame': {
				const { routerId, consumerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const consumer = routerData.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.requestKeyFrame();
				context.handled = true;

				break;
			}

			case 'createPipeDataConsumer': {
				const { routerId, pipeTransportId, dataProducerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeTransport = routerData.pipeTransports.get(pipeTransportId);

				if (!pipeTransport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				const dataProducer =
					routerData.dataProducers.get(dataProducerId) ??
					routerData.pipeDataProducers.get(dataProducerId);

				if (!dataProducer)
					throw new Error(`dataProducer with id "${dataProducerId}" not found`);

				const pipeDataConsumer = await pipeTransport.consumeData({
					dataProducerId: dataProducer.id,
				});

				routerData.pipeDataConsumers.set(pipeDataConsumer.id, pipeDataConsumer);
				pipeDataConsumer.observer.once('close', () => {
					routerData.pipeDataConsumers.delete(pipeDataConsumer.id);

					if (!pipeDataConsumer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeDataConsumerClosed',
							data: {
								routerId,
								pipeDataConsumerId: pipeDataConsumer.id
							}
						});
					}
				});

				response.id = pipeDataConsumer.id;
				response.sctpStreamParameters = pipeDataConsumer.sctpStreamParameters;
				response.label = pipeDataConsumer.label;
				response.protocol = pipeDataConsumer.protocol;
				context.handled = true;

				break;
			}

			case 'closePipeDataConsumer': {
				const { routerId, pipeDataConsumerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const pipeDataConsumer = routerData.pipeDataConsumers.get(pipeDataConsumerId);

				if (!pipeDataConsumer)
					throw new Error(`pipeDataConsumer with id "${pipeDataConsumerId}" not found`);

				pipeDataConsumer.appData.remoteClosed = true;
				pipeDataConsumer.close();
				context.handled = true;

				break;
			}

			case 'consumeData': {
				const {
					routerId,
					transportId,
					dataProducerId,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId) || 
					routerData.plainTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				const dataProducer =
					routerData.dataProducers.get(dataProducerId) ??
					routerData.pipeDataProducers.get(dataProducerId);

				if (!dataProducer)
					throw new Error(`dataProducer with id "${dataProducerId}" not found`);

				const dataConsumer = await transport.consumeData({ dataProducerId });
				
				routerData.dataConsumers.set(dataConsumer.id, dataConsumer);
				dataConsumer.observer.once('close', () => {
					routerData.dataConsumers.delete(dataConsumer.id);

					if (!dataConsumer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'dataConsumerClosed',
							data: {
								routerId,
								dataConsumerId: dataConsumer.id
							}
						});
					}
				});

				response.id = dataConsumer.id;
				response.sctpStreamParameters = dataConsumer.sctpStreamParameters;
				response.label = dataConsumer.label;
				response.protocol = dataConsumer.protocol;
				context.handled = true;

				break;
			}

			case 'closeDataConsumer': {
				const { routerId, dataConsumerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const dataConsumer = routerData.dataConsumers.get(dataConsumerId);

				if (!dataConsumer)
					throw new Error(`dataConsumer with id "${dataConsumerId}" not found`);

				dataConsumer.appData.remoteClosed = true;
				dataConsumer.close();
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
