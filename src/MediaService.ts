import { Logger } from './common/logger';
import * as mediasoup from 'mediasoup';
import os from 'os';
import { Router } from 'mediasoup/node/lib/Router';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import { Transport } from 'mediasoup/node/lib/Transport';
import { RtpHeaderExtension } from 'mediasoup/node/lib/RtpParameters';
import {
	Worker,
	WorkerLogLevel,
	WorkerLogTag
} from 'mediasoup/node/lib/Worker';
import { skipIfClosed } from './common/decorators';
import { List } from './common/list';
import { WebRtcTransport } from 'mediasoup/node/lib/WebRtcTransport';
import { PipeTransport } from 'mediasoup/node/lib/PipeTransport';
import { Producer } from 'mediasoup/node/lib/Producer';
import { DataProducer } from 'mediasoup/node/lib/DataProducer';
import { DataConsumer } from 'mediasoup/node/lib/DataConsumer';

const logger = new Logger('MediaService');

interface WorkerSettings {
	logLevel?: WorkerLogLevel;
	logTags?: WorkerLogTag[];
	rtcMinPort?: number;
	rtcMaxPort?: number;
	appData: {
		serverData: WorkerData;
	};
}

export interface WorkerData {
	consumers: Map<string, Consumer>;
	routersByRoomId: Map<string, Promise<Router>>;
}

export interface RouterData {
	roomId: string;
	workerPid: number;
	pipeTransports: Map<string, PipeTransport>;
	webRtcTransports: Map<string, WebRtcTransport>;
	producers: Map<string, Producer>;
	pipeProducers: Map<string, Producer>;
	consumers: Map<string, Consumer>;
	pipeConsumers: Map<string, Consumer>;
	dataProducers: Map<string, DataProducer>;
	pipeDataProducers: Map<string, DataProducer>;
	dataConsumers: Map<string, DataConsumer>;
	pipeDataConsumers: Map<string, DataConsumer>;
}

export default class MediaService {
	public static async create(): Promise<MediaService> {
		logger.debug('create()');

		const mediaService = new MediaService();

		await mediaService.startWorkers();

		return mediaService;
	}

	public closed = false;
	public workers = List<Worker>();

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.workers.items.forEach((w) => w.close());
		this.workers.clear();
	}

	@skipIfClosed
	private workerDied(worker: Worker, settings: WorkerSettings): void {
		logger.error('workerDied() restarting... [pid:%d]', worker.pid);

		this.workers.remove(worker);

		(async () => await this.startWorker(settings))().catch((error) => {
			logger.error('workerDied() error restarting [error: %o]', error);
		});
	}

	@skipIfClosed
	private async startWorker(settings: WorkerSettings): Promise<void> {
		const worker = await mediasoup.createWorker(settings);
		const workerData = worker.appData.serverData as WorkerData;

		logger.debug('startWorker() worker started [workerPid: %s]', worker.pid);

		this.workers.add(worker);

		worker.observer.on('newrouter', (router: Router) => {
			router.observer.on('newtransport', (transport: Transport) => {
				transport.observer.on('newconsumer', (consumer: Consumer) => {
					if (!consumer.closed) {
						consumer.observer.once('close', () => workerData.consumers.delete(consumer.id));
						workerData.consumers.set(consumer.id, consumer);
					}
				});
			});
		});

		worker.once('died', () => this.workerDied(worker, settings));
	}

	@skipIfClosed
	public async startWorkers(
		numberOfWorkers = os.cpus().length,
		rtcMinPort = 40000,
		rtcMaxPort = 49999,
	): Promise<void> {
		logger.debug('startWorkers() [numberOfWorkers: %s]', numberOfWorkers);

		for (let i = 0; i < numberOfWorkers; ++i) {
			let settings;

			if (process.env.NODE_ENV === 'development') {
				settings = {
					logLevel: 'debug',
					logTags: [ 'info', 'simulcast', 'bwe', 'score', 'message', 'svc', 'rtx', 'rtp', 'rtcp', 'ice' ],
					rtcMinPort,
					rtcMaxPort,
					appData: {
						serverData: {
							consumers: new Map<string, Consumer>(),
							routersByRoomId: new Map<string, Promise<Router>>(),
						} as WorkerData
					},
				} as WorkerSettings;
			} else {
				settings = {
					rtcMinPort,
					rtcMaxPort,
					appData: {
						serverData: {
							consumers: new Map<string, Consumer>(),
							routersByRoomId: new Map<string, Promise<Router>>(),
						} as WorkerData
					},
				} as WorkerSettings;
			}

			await this.startWorker(settings);
		}
	}

	@skipIfClosed
	private async getOrCreateRouter(roomId: string, worker: Worker): Promise<Router> {
		logger.debug('getOrCreateRouter() [roomId: %s, workerPid: %s]', roomId, worker.pid);

		const workerData = worker.appData.serverData as WorkerData;

		let routerPromise = workerData.routersByRoomId.get(roomId);

		if (!routerPromise) {
			routerPromise = new Promise<Router>(async (resolve, reject) => {
				let router: Router | undefined;

				try {
					router = await worker.createRouter({
						mediaCodecs: [ {
							kind: 'audio',
							mimeType: 'audio/opus',
							clockRate: 48000,
							channels: 2
						}, {
							kind: 'video',
							mimeType: 'video/VP8',
							clockRate: 90000,
							parameters: { 'x-google-start-bitrate': 500 }
						} ],
						appData: {
							serverData: {
								roomId,
								workerPid: worker.pid,
								pipeTransports: new Map<string, PipeTransport>(),
								webRtcTransports: new Map<string, WebRtcTransport>(),
								producers: new Map<string, Producer>(),
								pipeProducers: new Map<string, Producer>(),
								consumers: new Map<string, Consumer>(),
								pipeConsumers: new Map<string, Consumer>(),
								dataProducers: new Map<string, DataProducer>(),
								pipeDataProducers: new Map<string, DataProducer>(),
								dataConsumers: new Map<string, DataConsumer>(),
								pipeDataConsumers: new Map<string, DataConsumer>(),
							} as RouterData
						}
					});

					logger.debug(
						'getOrCreateRouter() new router [roomId: %s, routerId: %s, workerPid: %s]',
						roomId,
						router.id,
						worker.pid
					);
	
					router.observer.once('close', () => {
						logger.debug(
							'getOrCreateRouter() router closed [roomId: %s, routerId: %s, workerId: %s]',
							roomId,
							router?.id,
							worker.pid
						);
	
						workerData.routersByRoomId.delete(roomId);
					});
	
					const { rtpCapabilities } = router;
	
					rtpCapabilities.headerExtensions = rtpCapabilities.headerExtensions?.filter(
						(ext: RtpHeaderExtension) => ext.uri !== 'urn:3gpp:video-orientation');
	
					resolve(router);
				} catch (error) {
					router?.close();

					reject(error);
				}
			});

			workerData.routersByRoomId.set(roomId, routerPromise);
		}

		return routerPromise;
	}

	@skipIfClosed
	public async getRouter(roomId: string): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const roomRouters: Router[] = [];

		for (const { appData: { serverData } } of this.workers.items) {
			const r = await (serverData as WorkerData).routersByRoomId.get(roomId);

			if (r) roomRouters.push(r);
		}

		// Create a new array, we don't want to mutate the original one
		const leastLoadedWorkers = [ ...this.workers.items ].sort((a, b) =>
			(a.appData.serverData as WorkerData).consumers.size -
			(b.appData.serverData as WorkerData).consumers.size);

		if (roomRouters.length === 0) {
			logger.debug('getRouter() first client [roomId: %s]', roomId);

			return this.getOrCreateRouter(roomId, leastLoadedWorkers[0]);
		}

		const leastLoadedRoomWorkerPids = roomRouters.map((router) =>
			(router.appData.serverData as RouterData).workerPid);
		const leastLoadedRoomWorkers = leastLoadedWorkers
			.filter((worker) => leastLoadedRoomWorkerPids.includes(worker.pid));

		for (const worker of leastLoadedRoomWorkers) {
			const workerData = worker.appData.serverData as WorkerData;

			if (workerData.consumers.size < 500) {
				logger.debug(
					'getRouter() worker has capacity [roomId: %s, load: %s]',
					roomId,
					workerData.consumers.size
				);

				return this.getOrCreateRouter(roomId, worker);
			}
		}

		const leastLoadedWorkerData =
			leastLoadedWorkers[0].appData.serverData as WorkerData;

		if (leastLoadedRoomWorkers.length > 0) {
			const leastLoadedRoomWorkerData =
				leastLoadedRoomWorkers[0].appData.serverData as WorkerData;

			if (leastLoadedRoomWorkers[0].pid === leastLoadedWorkers[0].pid) {
				logger.debug(
					'getRouter() room worker least loaded [roomId: %s, load: %s]',
					roomId,
					leastLoadedRoomWorkerData.consumers.size
				);

				return this.getOrCreateRouter(roomId, leastLoadedRoomWorkers[0]);
			}

			if (
				leastLoadedRoomWorkerData.consumers.size -
				leastLoadedWorkerData.consumers.size < 100
			) {
				logger.debug(
					'getRouter() low delta [roomId: %s, load: %s]',
					roomId,
					leastLoadedRoomWorkerData.consumers.size
				);

				return this.getOrCreateRouter(roomId, leastLoadedRoomWorkers[0]);
			}
		}

		logger.debug(
			'getRouter() last resort [roomId: %s, load: %s]',
			roomId,
			leastLoadedWorkerData.consumers.size
		);

		return this.getOrCreateRouter(roomId, leastLoadedWorkers[0]);
	}
}