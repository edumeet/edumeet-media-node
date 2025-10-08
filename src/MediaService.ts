import * as mediasoup from 'mediasoup';
import { MediasoupMonitor, createMediasoupMonitor, MediasoupMonitorConfig, TransportTypeFunction, MediasoupTransportType } from '@observertc/sfu-monitor-js';
import { List, Logger, skipIfClosed } from 'edumeet-common';

import { ActiveSpeakerObserver, AudioLevelObserver, Consumer, DataConsumer, DataProducer, PipeTransport, Producer, Router, RtpHeaderExtension, Transport, TransportListenInfo, WebRtcServer, WebRtcTransport, PlainTransport, Worker, WorkerLogLevel, WorkerLogTag } from 'mediasoup/types';

const logger = new Logger('MediaService');

interface WorkerSettings {
	logLevel?: WorkerLogLevel;
	logTags?: WorkerLogTag[];
	rtcMinPort?: number;
	rtcMaxPort?: number;
	appData: Record<string, unknown>;
}

export interface WorkerData {
	consumers: Map<string, Consumer>;
	routersByRoomId: Map<string, Promise<Router>>;
	webRtcServer: WebRtcServer;
	resourceUsage: mediasoup.types.WorkerResourceUsage;
	cpuUsage: number;
}

export interface RouterData {
	roomId: string;
	webRtcServer: WebRtcServer;
	workerPid: number;
	pipeTransports: Map<string, PipeTransport>;
	webRtcTransports: Map<string, WebRtcTransport>;
    plainTransports: Map<string, PlainTransport>;
	producers: Map<string, Producer>;
	pipeProducers: Map<string, Producer>;
	consumers: Map<string, Consumer>;
	pipeConsumers: Map<string, Consumer>;
	dataProducers: Map<string, DataProducer>;
	pipeDataProducers: Map<string, DataProducer>;
	dataConsumers: Map<string, DataConsumer>;
	pipeDataConsumers: Map<string, DataConsumer>;
	activeSpeakerObservers: Map<string, ActiveSpeakerObserver>;
	audioLevelObservers: Map<string, AudioLevelObserver>;
	remoteClose?: boolean;
}

interface MetricsData {
	consumers: number;
	routers: number;
}

export interface MediaServiceOptions {
	ip?: string;
	ip6?: string;
	announcedIp?: string;
	announcedIp6?: string;
	initialAvailableOutgoingBitrate: number;
	maxIncomingBitrate: number;
	maxOutgoingBitrate: number;
	rtcMinPort: number;
	rtcMaxPort: number;
	numberOfWorkers: number;
	useObserveRTC: boolean;
	pollStatsProbability: number;
	loadPollingInterval: number;
	cpuPercentCascadingLimit: number;
}

export default class MediaService {
	public static async create(options: MediaServiceOptions): Promise<MediaService> {
		logger.debug('create()');

		const mediaService = new MediaService(options);

		await mediaService.startWorkers(options);

		return mediaService;
	}

	public closed = false;
	public ip: string | undefined;
	public ip6: string | undefined;
	public announcedIp?: string;
	public announcedIp6?: string;
	public initialAvailableOutgoingBitrate: number;
	public maxIncomingBitrate: number;
	public maxOutgoingBitrate: number;
	public workers = List<Worker>();
	public readonly monitor?: MediasoupMonitor;
	private readonly loadPollingInterval: number;
	private readonly cpuPercentCascadingLimit: number;
	private workerResourceCheckInterval?: NodeJS.Timeout;

	constructor({
		ip,
		ip6,
		announcedIp,
		announcedIp6,
		initialAvailableOutgoingBitrate,
		maxIncomingBitrate,
		maxOutgoingBitrate,
		useObserveRTC,
		pollStatsProbability,
		loadPollingInterval,
		cpuPercentCascadingLimit,
	}: MediaServiceOptions) {
		logger.debug('constructor()');

		if (ip)
			this.ip = ip;
		if (ip6)
			this.ip6 = ip6;

		if (announcedIp && announcedIp !== ip) this.announcedIp = announcedIp;
		if (announcedIp6 && announcedIp6 !== ip6) this.announcedIp6 = announcedIp6;

		this.initialAvailableOutgoingBitrate = initialAvailableOutgoingBitrate;
		this.maxIncomingBitrate = maxIncomingBitrate;
		this.maxOutgoingBitrate = maxOutgoingBitrate;
		this.monitor = useObserveRTC ? this.createMonitor(pollStatsProbability) : undefined;
		this.loadPollingInterval = loadPollingInterval;
		this.cpuPercentCascadingLimit = cpuPercentCascadingLimit;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		clearInterval(this.workerResourceCheckInterval);

		this.workers.items.forEach((w) => w.close());
		this.workers.clear();
	}

	public getMetrics(): Record<string, MetricsData> {
		const metrics: Record<string, MetricsData> = {};

		this.workers.items.forEach((worker) => {
			const workerData = worker.appData as unknown as WorkerData;

			metrics[worker.pid] = {
				consumers: workerData.consumers.size,
				routers: workerData.routersByRoomId.size,
			};
		});

		return metrics;
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
		const workerData = worker.appData as unknown as WorkerData;

		const options: { listenInfos: Array<TransportListenInfo> } = {
			listenInfos: []
		};

		if (this.ip) {
			options.listenInfos.push(
				{
					protocol: 'udp',
					ip: this.ip,
					announcedIp: this.announcedIp || undefined, // Ensure announcedIp is undefined if not provided
				},
				{
					protocol: 'tcp',
					ip: this.ip,
					announcedIp: this.announcedIp || undefined,
				}
			);
		}

		if (this.ip6) {
			options.listenInfos.push(
				{
					protocol: 'udp',
					ip: this.ip6,
					announcedIp: this.announcedIp6 || undefined,
				},
				{
					protocol: 'tcp',
					ip: this.ip6,
					announcedIp: this.announcedIp6 || undefined,
				}
			);
		}

		const webRtcServer = await worker.createWebRtcServer(options);

		workerData.webRtcServer = webRtcServer;

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
	public async startWorkers({
		rtcMinPort,
		rtcMaxPort,
		numberOfWorkers,
	}: MediaServiceOptions): Promise<void> {
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
						consumers: new Map<string, Consumer>(),
						routersByRoomId: new Map<string, Promise<Router>>(),
						cpuUsage: 0,
					}
				} as WorkerSettings;
			} else {
				settings = {
					rtcMinPort,
					rtcMaxPort,
					appData: {
						consumers: new Map<string, Consumer>(),
						routersByRoomId: new Map<string, Promise<Router>>(),
						cpuUsage: 0,
					}
				} as WorkerSettings;
			}

			await this.startWorker(settings);
		}

		this.workerResourceCheckInterval = setInterval(async () => {
			const resourses = await Promise.allSettled(
				this.workers.items.map((w) => w.getResourceUsage())
			);
			
			const usages: number[] = [];

			resourses.forEach((result, index) => {
				if (result.status === 'fulfilled') {
					const worker = this.workers.items[index];
					const workerData = worker.appData as unknown as WorkerData;

					/* eslint-disable camelcase */
					const {	ru_utime: oldRuUtime, ru_stime: oldRuStime } = 
						workerData.resourceUsage ?? { ru_utime: 0, ru_stime: 0 };
					const { ru_utime: newRuUtime, ru_stime: newRuStime } = result.value;

					workerData.cpuUsage = (
						(newRuUtime + newRuStime - oldRuUtime - oldRuStime) / 
						this.loadPollingInterval
					) * 100;
					/* eslint-enable camelcase */
					workerData.resourceUsage = result.value;

					usages.push(workerData.cpuUsage);
				} else {
					logger.error('startWorkers() error getting worker resource usage [error: %o]', result.reason);
				}
			});
		}, this.loadPollingInterval);
	}

	@skipIfClosed
	private async getOrCreateRouterPromise(
		roomId: string, 
		worker: Worker
	): Promise<Router> {
		logger.debug('getOrCreateRouter() [roomId: %s, workerPid: %s]', roomId, worker.pid);

		const workerData = worker.appData as unknown as WorkerData;

		let routerPromise = workerData.routersByRoomId.get(roomId);

		if (!routerPromise) {
			routerPromise = (async () => {
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
						}, {
							kind: 'video',
							mimeType: 'video/h264',
							clockRate: 90000,
							parameters: {
								'packetization-mode': 1,
								'profile-level-id': '42e01f',
								'level-asymmetry-allowed': 1,
								'x-google-start-bitrate': 500
							}
						}, {
							kind: 'video',
							mimeType: 'video/VP9',
							clockRate: 90000,
							parameters: {
								'profile-id': 0,
								'x-google-start-bitrate': 500
							}
						} ],
						appData: {
							roomId,
							webRtcServer: workerData.webRtcServer,
							workerPid: worker.pid,
							pipeTransports: new Map<string, PipeTransport>(),
							webRtcTransports: new Map<string, WebRtcTransport>(),
							plainTransports: new Map<string, PlainTransport>(),
							producers: new Map<string, Producer>(),
							pipeProducers: new Map<string, Producer>(),
							consumers: new Map<string, Consumer>(),
							pipeConsumers: new Map<string, Consumer>(),
							dataProducers: new Map<string, DataProducer>(),
							pipeDataProducers: new Map<string, DataProducer>(),
							dataConsumers: new Map<string, DataConsumer>(),
							pipeDataConsumers: new Map<string, DataConsumer>(),
							activeSpeakerObservers: new Map<string, ActiveSpeakerObserver>(),
							audioLevelObservers: new Map<string, AudioLevelObserver>(),
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

					return router;
				} catch (error) {
					router?.close();

					throw error;
				}
			})();

			workerData.routersByRoomId.set(roomId, routerPromise);
		}

		return routerPromise;
	}

	@skipIfClosed
	public async getRouter(roomId: string): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const roomRouters: Router[] = [];

		for (const { appData } of this.workers.items) {
			const r = await (appData as unknown as WorkerData).routersByRoomId.get(roomId);

			if (r) roomRouters.push(r);
		}

		// Create a new array, we don't want to mutate the original one
		const leastLoadedWorkers = [ ...this.workers.items ].sort((a, b) =>
			(a.appData as unknown as WorkerData).cpuUsage -
			(b.appData as unknown as WorkerData).cpuUsage);

		if (roomRouters.length === 0) {
			logger.debug('getRouter() first client [roomId: %s]', roomId);

			return this.getOrCreateRouterPromise(roomId, leastLoadedWorkers[0]);
		}

		const leastLoadedRoomWorkerPids = roomRouters.map((router) =>
			(router.appData as unknown as RouterData).workerPid);
		const leastLoadedRoomWorkers = leastLoadedWorkers
			.filter((worker) => leastLoadedRoomWorkerPids.includes(worker.pid));

		const leastLoadedRoomWorkerData =
			leastLoadedRoomWorkers[0].appData as unknown as WorkerData;

		// CPU usage is below the cascading limit, use the least loaded room worker
		if (leastLoadedRoomWorkerData.cpuUsage < this.cpuPercentCascadingLimit) {
			logger.debug(
				'getRouter() worker has capacity [roomId: %s, cpuUsage: %s]',
				roomId,
				leastLoadedRoomWorkerData.cpuUsage
			);

			return this.getOrCreateRouterPromise(roomId, leastLoadedRoomWorkers[0]);
		}

		const leastLoadedWorkerData =
			leastLoadedWorkers[0].appData as unknown as WorkerData;

		if (leastLoadedRoomWorkers[0].pid === leastLoadedWorkers[0].pid) {
			logger.debug(
				'getRouter() room worker least loaded [roomId: %s, cpuUsage: %s]',
				roomId,
				leastLoadedRoomWorkerData.cpuUsage
			);

			return this.getOrCreateRouterPromise(roomId, leastLoadedRoomWorkers[0]);
		}

		if (
			leastLoadedRoomWorkerData.cpuUsage -
			leastLoadedWorkerData.cpuUsage < 10
		) {
			logger.debug(
				'getRouter() low delta [roomId: %s, cpuUsage: %s]',
				roomId,
				leastLoadedRoomWorkerData.cpuUsage
			);

			return this.getOrCreateRouterPromise(roomId, leastLoadedRoomWorkers[0]);
		}

		logger.debug(
			'getRouter() last resort [roomId: %s, cpuUsage: %s]',
			roomId,
			leastLoadedWorkerData.cpuUsage
		);

		return this.getOrCreateRouterPromise(roomId, leastLoadedWorkers[0]);
	}

	@skipIfClosed
	private createMonitor(pollStatsProbability: number): MediasoupMonitor {
		let pollStats: () => boolean;

		if (pollStatsProbability <= 0.0) {
			pollStats = () => false;
		} else if (pollStatsProbability < 1.0) {
			pollStats = () => Math.random() <= pollStatsProbability;
		} else {
			pollStats = () => true;
		}

		const getTransportType: TransportTypeFunction = (transport) => {
			return transport.constructor.name as MediasoupTransportType;
		};

		const config: MediasoupMonitorConfig = {};

		/* const config: MediasoupMonitorConfig = {
			collectingPeriodInMs: 5000,
			samplingPeriodInMs: 30000,
			mediasoup,
			mediasoupCollectors: {
				getTransportType,
				pollDirectTransportStats: pollStats,
				pollPlainRtpTransportStats: pollStats,
				pollWebRtcTransportStats: pollStats,
				pollPipeTransportStats: pollStats,
				pollConsumerStats: pollStats,
				pollProducerStats: pollStats,
				pollDataProducerStats: pollStats,
				pollDataConsumerStats: pollStats,
			}
		}; */

		return createMediasoupMonitor(config);
	}
}
