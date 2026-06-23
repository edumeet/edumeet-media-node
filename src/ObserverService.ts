import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from 'edumeet-common';
import { readFile } from 'fs/promises';
import { DataConsumer } from 'mediasoup/types';
import * as mediasoup from 'mediasoup';
import {
	createDefaultMediasoupRemoteTrackResolverFactory,
	createJsonlFileSinkFactory,
	JsonlFileSink,
	ObservedCall,
	Observer,
	ObserverEvents,
	setObserverLogger,
} from '@observertc/observer-js';

const logger = new Logger('ObserverService');

setObserverLogger({
	debug: () => void 0,
	info: (...args) => logger.debug(...args),
	warn: (...args) => logger.warn(...args),
	error: (...args) => logger.error(...args),
	trace: () => void 0,
})

export type ObservedCallAppData = {
	roomId: string | undefined;
	clients: Record<string, {
		displayName?: string,
	}>;
	routerIds: string[];
}

export type ObserverServiceOptions = {
	clientSamplesOutputDirectory?: string;
	s3Bucket?: string;
	/**
	 * Custom S3-compatible endpoint URL (e.g. MinIO inside the cluster).
	 * When set, `forcePathStyle` is automatically enabled so the bucket name
	 * is part of the URL path rather than the hostname — required by MinIO.
	 * Leave undefined to target AWS S3.
	 *
	 * Example: "http://minio.minio-ns.svc.cluster.local:9000"
	 */
	s3Endpoint?: string;
}

export type ObserverServiceEvents = Omit<ObserverEvents, 'observer-closed' | 'sample-rejected'>;

/**
 * Process-level singleton (created once in server.ts).
 *
 * Receives ClientSample payloads from clients via an SCTP data channel
 * (label: 'observertc-samples'), feeds them into an @observertc/observer-js
 * Observer instance.
 *
 * If both `clientSamplesOutputDirectory` and `s3Bucket` are set, each JSONL
 * file written locally is uploaded to S3 when its sink closes (i.e. when the
 * observed client leaves). AWS credentials are resolved via the standard SDK
 * credential chain (env vars, IAM instance profile, ~/.aws/credentials, etc.).
 */
export class ObserverService extends Observer {
	private readonly s3Client?: S3Client;
	private readonly s3Bucket?: string;

	public constructor(public options: ObserverServiceOptions) {
		super({
			createClientSink: options.clientSamplesOutputDirectory
				? createJsonlFileSinkFactory({ directory: options.clientSamplesOutputDirectory })
				: undefined,
			closeCallIfEmptyForMs: 5 * 60 * 1000, // 5 minutes
			closeClientIfIdleForMs: 1 * 60 * 1000, // 1 minute,
			createTrackResolver: createDefaultMediasoupRemoteTrackResolverFactory(),
		});

		logger.debug('constructor()');

		if (options.s3Bucket) {
			this.s3Bucket = options.s3Bucket;
			this.s3Client = new S3Client({
				// MinIO ignores the region but the AWS SDK requires one to be set.
				// Fall back to us-east-1 when using a custom endpoint.
				region: process.env.AWS_DEFAULT_REGION ?? (options.s3Endpoint ? 'us-east-1' : undefined),
				...(options.s3Endpoint && {
					endpoint: options.s3Endpoint,
					forcePathStyle: true, // required for MinIO
				}),
			});
			logger.debug('constructor() | S3 upload enabled [bucket:%s, endpoint:%s]',
				this.s3Bucket,
				options.s3Endpoint ?? 'AWS'
			);
		}

		this.setupObserverEvents();
		this.config.createCallAppData = this.createObservedCallAppData.bind(this);

	}

	/**
	 * Register a mediasoup DataProducer that carries observer samples.
	 * Called from producerMiddleware when label === 'observertc-samples'.
	 */
	public addDataConsumer(dataConsumer: DataConsumer): void {
		logger.debug('add() [id:%s]', dataConsumer.id);

		const onMessage = (payload: Buffer | string) => {
			try {
				const text = Buffer.isBuffer(payload)
					? payload.toString('utf8')
					: String(payload);

				const sample = JSON.parse(text);

				this.accept(sample);
			} catch (error) {
				logger.error(
					'addDataConsumer() | error accepting sample [dataConsumerId:%s, error:%o]',
					dataConsumer.id,
					error
				);
			}
		};

		dataConsumer.observer.once('close', () => {
			dataConsumer.off('message', onMessage);
		});
		dataConsumer.on('message', onMessage);
	}

	private createObservedCallAppData(): ObservedCallAppData {
		return {
			roomId: undefined, // populated from client sample attachments via 'client-updated'
			clients: {},
			routerIds: [],
		};
	}

	private setupObserverEvents(): void {
		this.on('client-sink-created', ({ sink, observedCall, observedClient }) => {
			const sourcePath = sink instanceof JsonlFileSink ? sink.path : undefined;

			if (!sourcePath || !this.s3Client) return;

			sink.once('close', async () => {
				const sampleAttachments = observedClient.attachments as Record<string, unknown> | undefined;
				const roomId = observedCall.appData?.roomId ?? (sampleAttachments?.['roomId'] as string | undefined) ?? 'unknown-room';
				const targetKey = `${roomId}/${observedCall.callId}/${observedClient.clientId}.jsonl`;

				try {
					await this.uploadToS3(sourcePath, targetKey).catch((error) =>
						logger.error('"sink-close" | S3 upload failed [key:%s, error:%o]', targetKey, error)
					);
				} catch (error) {
					logger.error('"sink-close" | S3 upload failed [key:%s, error:%o]', targetKey, error);
				}
			});
		});
		this.on('client-updated', ({ observedClient }) => {
			const observedCall = observedClient.call as ObservedCall<ObservedCallAppData>;

			if (!observedCall.appData?.roomId && observedClient.attachments?.roomId) {

				observedCall.appData.roomId = observedClient.attachments.roomId as string;

				logger.debug('client-updated() | set call appData roomId [callId:%s, roomId:%s]', observedClient.call.callId, observedCall.appData.roomId);
			}

			if (observedCall.appData?.clients && observedClient.attachments?.displayName) {
				observedCall.appData.clients[observedClient.clientId].displayName = observedClient.attachments.displayName as string;
			}

		});
		this.on('peer-connection-added', ({ observedClient, observedCall, observedPeerConnection }) => {
			logger.debug('"peer-connection-added" | new peer connection [callId:%s, clientId:%s, peerConnectionId: %s]', observedCall.callId, observedClient.clientId, observedPeerConnection.peerConnectionId);
		});

		this.on('client-added', (scope) => {
			const observedCall = scope.observedCall as ObservedCall<ObservedCallAppData>;

			observedCall.appData.clients[scope.observedClient.clientId] = {

			};
		});
		this.on('call-closed', async (scope) => {
			const observedCall = scope.observedCall as ObservedCall<ObservedCallAppData>;

			logger.debug('"call-closed" | call closed [callId:%s, appData:%o]', observedCall.callId, observedCall.appData);

			if (!observedCall.appData) return;

			try {
				const sample = JSON.stringify({
					...observedCall.appData,
					numberOfIssues: observedCall.numberOfIssues,
					clientsUsedTurn: [...observedCall.clientsUsedTurn],
				});

				const callRoomId = observedCall.appData.roomId ?? 'unknown-room';
			const targetKey = `${callRoomId}/${observedCall.callId}/call-summary.json`;

				await this.uploadObjectToS3(sample, targetKey);
			} catch (error) {
				logger.error('"call-closed" | S3 upload failed [callId:%s, error:%o]', observedCall.callId, error);
			}
		});

		mediasoup.observer.on('newworker', (worker) => {
			const onNewRouter = (router: mediasoup.types.Router) => {
				this.createObservedMediasoupRouter({
					router,
					matchPeerConnectionByWebRtcTransportId: true,
				});
			};

			worker.observer.once('close', () => {
				worker.observer.off('newrouter', onNewRouter);
			});
			worker.observer.on('newrouter', onNewRouter);
		});


		this.on('mediasoup-router-added', ({ observedMediasoupRouter }) => {
			logger.debug('"mediasoup-router-added" | new router added [routerId:%s, sample:%o]', observedMediasoupRouter.router.id, observedMediasoupRouter.sample);
		});
		this.on('mediasoup-router-matched-with-peer-connection', ({ observedClient, observedCall, observedMediasoupRouter }) => {
			observedMediasoupRouter.appData = {
				observedCall,
			};

			logger.debug('"mediasoup-router-matched-with-peer-connection" | router matched with peer connection [routerId:%s, callId:%s, clientId:%s]', observedMediasoupRouter.router.id, observedCall.callId, observedClient.clientId);

			observedClient.injectAttachment({
				routerId: observedMediasoupRouter.router.id,
			});

			const callAppData = (observedCall as ObservedCall<ObservedCallAppData>).appData;

			if (callAppData?.routerIds && !callAppData.routerIds.includes(observedMediasoupRouter.router.id)) {
				callAppData.routerIds.push(observedMediasoupRouter.router.id);
			}
		});
		this.on('mediasoup-router-removed', async ({ observedMediasoupRouter }) => {
			logger.debug('"mediasoup-router-removed" | router removed [routerId:%s, sample:%o, appData:%o]', observedMediasoupRouter.router.id, observedMediasoupRouter.sample, observedMediasoupRouter.appData);

			if (!observedMediasoupRouter.appData?.observedCall) return;

			const observedCall = observedMediasoupRouter.appData.observedCall as ObservedCall<ObservedCallAppData>;

			if (!observedCall.appData.roomId) return;

			try {
				const sample = JSON.stringify(observedMediasoupRouter.sample);
				const roomId = observedCall.appData.roomId;
				const targetKey = `${roomId}/${observedCall.callId}/mediasoup-router-${observedMediasoupRouter.router.id}.json`;

				await this.uploadObjectToS3(sample, targetKey)
			} catch (error) {
				logger.error('"mediasoup-router-removed" | S3 upload failed [routerId:%s, error:%o]', observedMediasoupRouter.router.id, error);
			}
		});

	}

	private async uploadToS3(sourcePath: string, targetKey: string): Promise<void> {
		if (!this.s3Client || !this.s3Bucket) return;

		const body = await readFile(sourcePath);

		return this.uploadObjectToS3(body, targetKey);
	}

	private async uploadObjectToS3(Body: string | Uint8Array | Buffer, targetKey: string): Promise<void> {
		if (!this.s3Client || !this.s3Bucket) return;

		logger.debug('uploadObjectToS3() | uploading to S3 [key:%s]', targetKey);

		await this.s3Client.send(new PutObjectCommand({
			Bucket: this.s3Bucket,
			Key: targetKey,
			Body,
			ContentType: 'application/x-ndjson',
		}));

		logger.debug('uploadObjectToS3() | uploaded [key:%s]', targetKey);
	}


}
