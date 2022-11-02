import config from '../../config/config.json';
import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { RouterData } from '../MediaService';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('TransportMiddleware');

export const createTransportMiddleware = ({
	roomServer,
}: MiddlewareOptions): Middleware<RoomServerConnectionContext> => {
	logger.debug('createTransportMiddleware()');

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

			case 'createPipeTransport': {
				const { routerId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = await router.createPipeTransport({
					...config.mediasoup.pipeTransport
				});

				routerData.pipeTransports.set(transport.id, transport);
				transport.observer.once('close', () => {
					routerData.pipeTransports.delete(transport.id);

					if (!transport.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeTransportClosed',
							data: {
								routerId,
								pipeTransportId: transport.id
							}
						});
					}
				});

				response.id = transport.id;
				response.ip = transport.tuple.localIp;
				response.port = transport.tuple.localPort;
				response.srtpParameters = transport.srtpParameters;
				context.handled = true;

				break;
			}

			case 'connectPipeTransport': {
				const {
					routerId,
					pipeTransportId,
					...transportOptions
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.pipeTransports.get(pipeTransportId);

				if (!transport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				await transport.connect(transportOptions);

				context.handled = true;

				break;
			}

			case 'closePipeTransport': {
				const {
					routerId,
					pipeTransportId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.pipeTransports.get(pipeTransportId);

				if (!transport)
					throw new Error(`pipeTransport with id "${pipeTransportId}" not found`);

				transport.appData.remoteClosed = true;
				transport.close();
				context.handled = true;

				break;
			}

			case 'createWebRtcTransport': {
				const {
					routerId,
					forceTcp,
					sctpCapabilities,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const webRtcTransportOptions = {
					...config.mediasoup.webRtcTransport,
					enableSctp: Boolean(sctpCapabilities),
					numSctpStreams: (sctpCapabilities ?? {}).numStreams,
					enableTcp: true,
					enableUdp: !forceTcp,
					preferUdp: !forceTcp,
					appData: {
						router
					}
				};

				const transport = await router.createWebRtcTransport(
					webRtcTransportOptions
				);

				routerData.webRtcTransports.set(transport.id, transport);
				transport.observer.once('close', () => {
					routerData.webRtcTransports.delete(transport.id);

					if (!transport.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'webRtcTransportClosed',
							data: {
								routerId,
								transportId: transport.id
							}
						});
					}
				});

				response.id = transport.id;
				response.iceParameters = transport.iceParameters;
				response.iceCandidates = transport.iceCandidates;
				response.dtlsParameters = transport.dtlsParameters;
				response.sctpParameters = transport.sctpParameters;
				context.handled = true;

				const { maxIncomingBitrate } = config.mediasoup.webRtcTransport;
				
				if (maxIncomingBitrate) {
					(async () => {
						await transport.setMaxIncomingBitrate(maxIncomingBitrate);
					})().catch();
				}

				break;
			}

			case 'connectWebRtcTransport': {
				const {
					routerId,
					transportId,
					dtlsParameters
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				await transport.connect({ dtlsParameters });
				context.handled = true;

				break;
			}

			case 'closeWebRtcTransport': {
				const {
					routerId,
					transportId
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				transport.appData.remoteClosed = true;
				transport.close();
				context.handled = true;

				break;
			}

			case 'restartIce': {
				const { routerId, transportId } = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);
				
				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				response.iceParameters = await transport.restartIce();
				context.handled = true;

				break;
			}

			case 'setMaxIncomingBitrate': {
				const {
					routerId,
					transportId,
					bitrate
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = routerData.webRtcTransports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				await transport.setMaxIncomingBitrate(bitrate);
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