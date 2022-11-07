import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
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
			connectionId,
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

				// Notify any other room servers that might be connected
				roomServerConnection.notify({
					method: 'newPipeConsumer',
					data: {
						routerId,
						pipeTransportId,
						pipeConsumerId: pipeConsumer.id,
						producerId: producer.id,
						kind: pipeConsumer.kind,
						producerPaused: pipeConsumer.producerPaused,
						rtpParameters: pipeConsumer.rtpParameters,
					}
				}, connectionId);

				pipeConsumer.observer.once('close', () => {
					routerData.pipeConsumers.delete(pipeConsumer.id);

					if (!pipeConsumer.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeConsumerClosed',
							data: {
								routerId,
								pipeConsumerId: pipeConsumer.id
							}
						}, pipeConsumer.appData.remoteClosedBy as string);
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
				pipeConsumer.appData.remoteClosedBy = connectionId;
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
				const transport = routerData.webRtcTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				const producer =
					routerData.producers.get(producerId) ??
					routerData.pipeProducers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				try {
					const consumer = await transport.consume({
						producerId: producer.id,
						rtpCapabilities,
						paused: producer.kind === 'video',
					});

					routerData.consumers.set(consumer.id, consumer);

					// Notify any other room servers that might be connected
					roomServerConnection.notify({
						method: 'newConsumer',
						data: {
							routerId,
							transportId,
							consumerId: consumer.id,
							producerId: producer.id,
							kind: consumer.kind,
							paused: consumer.paused,
							producerPaused: consumer.producerPaused,
							rtpParameters: consumer.rtpParameters,
						}
					}, connectionId);

					consumer.observer.once('close', () => {
						routerData.consumers.delete(consumer.id);

						if (!consumer.appData.remoteClosed) {
							roomServerConnection.notify({
								method: 'consumerClosed',
								data: {
									routerId,
									consumerId: consumer.id
								}
							}, consumer.appData.remoteClosedBy as string);
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
			
					consumer.on('score', (score) => roomServerConnection.notify({
						method: 'consumerScore',
						data: {
							routerId,
							consumerId: consumer.id,
							score
						}
					}));
			
					consumer.on('layerschange', (layers) => roomServerConnection.notify({
						method: 'consumerLayersChanged',
						data: {
							routerId,
							consumerId: consumer.id,
							layers
						}
					}));

					response.id = consumer.id;
					response.kind = consumer.kind;
					response.paused = consumer.paused;
					response.producerPaused = consumer.producerPaused;
					response.rtpParameters = consumer.rtpParameters;
					context.handled = true;
				} catch (error) {
					throw new Error('consume failed');
				}

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
				consumer.appData.remoteClosedBy = connectionId;
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

				// Notify any other room servers that might be connected
				roomServerConnection.notify({
					method: 'consumerPaused',
					data: {
						routerId,
						consumerId
					}
				}, connectionId);

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

				// Notify any other room servers that might be connected
				roomServerConnection.notify({
					method: 'consumerResumed',
					data: {
						routerId,
						consumerId
					}
				}, connectionId);

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

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};