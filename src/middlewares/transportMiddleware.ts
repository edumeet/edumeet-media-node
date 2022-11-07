import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { RouterData } from '../MediaService';
import { RoomServerConnectionContext } from '../RoomServerConnection';

const logger = new Logger('TransportMiddleware');

export const createTransportMiddleware = ({
	roomServer,
	mediaService
}: MiddlewareOptions): Middleware<RoomServerConnectionContext> => {
	logger.debug('createTransportMiddleware()');

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
			case 'createPipeTransport': {
				const {
					routerId,
					internal = false,
				} = message.data;

				const router = roomServer.routers.get(routerId);

				if (!router)
					throw new Error(`router with id "${routerId}" not found`);

				const routerData = router.appData as unknown as RouterData;
				const transport = await router.createPipeTransport({
					listenIp: {
						ip: internal ? '127.0.0.1' : mediaService.ip,
						announcedIp: internal ? undefined : mediaService.announcedIp
					},
					enableSrtp: !internal,
					enableSctp: true,
					enableRtx: !internal,
				});

				routerData.pipeTransports.set(transport.id, transport);

				// Notify any other room servers that might be connected
				roomServerConnection.notify({
					method: 'newPipeTransport',
					data: {
						routerId,
						pipeTransportId: transport.id,
						ip: transport.tuple.localIp,
						port: transport.tuple.localPort,
						srtpParameters: transport.srtpParameters,
					}
				}, connectionId);

				transport.observer.once('close', () => {
					routerData.pipeTransports.delete(transport.id);

					if (!transport.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'pipeTransportClosed',
							data: {
								routerId,
								pipeTransportId: transport.id
							}
						}, transport.appData.remoteClosedBy as string);
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
				transport.appData.remoteClosedBy = connectionId;
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
				const transport = await router.createWebRtcTransport({
					webRtcServer: routerData.webRtcServer,
					initialAvailableOutgoingBitrate: mediaService.initialAvailableOutgoingBitrate,
					enableSctp: Boolean(sctpCapabilities),
					numSctpStreams: (sctpCapabilities ?? {}).numStreams,
					enableTcp: true,
					enableUdp: !forceTcp,
					preferUdp: !forceTcp,
				});

				routerData.webRtcTransports.set(transport.id, transport);

				// Notify any other room servers that might be connected
				roomServerConnection.notify({
					method: 'newWebRtcTransport',
					data: {
						routerId,
						transportId: transport.id,
						iceParameters: transport.iceParameters,
						iceCandidates: transport.iceCandidates,
						dtlsParameters: transport.dtlsParameters,
						sctpParameters: transport.sctpParameters,
					}
				}, connectionId);

				transport.observer.once('close', () => {
					routerData.webRtcTransports.delete(transport.id);

					if (!transport.appData.remoteClosed) {
						roomServerConnection.notify({
							method: 'webRtcTransportClosed',
							data: {
								routerId,
								transportId: transport.id
							}
						}, transport.appData.remoteClosedBy as string);
					}
				});

				response.id = transport.id;
				response.iceParameters = transport.iceParameters;
				response.iceCandidates = transport.iceCandidates;
				response.dtlsParameters = transport.dtlsParameters;
				response.sctpParameters = transport.sctpParameters;
				context.handled = true;
				
				if (mediaService.maxIncomingBitrate) {
					(async () => {
						await transport.setMaxIncomingBitrate(mediaService.maxIncomingBitrate);
					})().catch();
				}

				if (mediaService.maxOutgoingBitrate) {
					(async () => {
						await transport.setMaxOutgoingBitrate(mediaService.maxOutgoingBitrate);
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
				transport.appData.remoteClosedBy = connectionId;
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

				const iceParameters = await transport.restartIce();

				// Notify any other room servers that might be connected
				roomServerConnection.notify({
					method: 'restartedIce',
					data: {
						routerId,
						transportId,
						iceParameters
					}
				}, connectionId);

				response.iceParameters = iceParameters;
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