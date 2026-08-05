import { Logger } from 'edumeet-common';
import { stat, unlink } from 'fs/promises';
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
import { Uploader } from './uploader/Uploader';

const logger = new Logger('ObserverService');

/**
 * `roomId` reaches us inside a client-supplied sample attachment, so it can
 * never be trusted as a key segment. `encodeURIComponent` does not escape `..`,
 * so an unchecked value would survive into `HttpUploader.buildUrl()` and let URL
 * normalisation move the POST outside the configured base path. Anything that
 * is not a plain, bounded token is replaced by the fallback.
 */
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

const safeKeySegment = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string' || value === '.' || value === '..' || !SAFE_KEY_SEGMENT.test(value)) {
		if (value !== undefined) logger.warn('safeKeySegment() rejected unsafe segment [value: %s]', String(value));

		return fallback;
	}

	return value;
};

setObserverLogger({
	debug: () => void 0,
	info: (...args) => logger.debug(...args),
	warn: (...args) => logger.warn(...args),
	error: (...args) => logger.error(...args),
	trace: () => void 0,
});

export type ObservedCallAppData = {
	roomId: string | undefined;
	clients: Record<string, {
		displayName?: string,
	}>;
	routerIds: string[];
}

export type ObserverServiceOptions = {

	/**
	 * Directory the per-client JSONL files are written to.
	 *
	 * Required for uploading: the observer only creates a file sink when it has
	 * somewhere to write, and the uploader sends that file. Without it there is
	 * nothing worth uploading, so `uploader` is ignored.
	 */
	samplesStorePath?: string;

	uploader?: Uploader;
}

export type ObserverServiceEvents = Omit<ObserverEvents, 'observer-closed' | 'sample-rejected'>;

/** The single argument the observer hands a listener for event `K`. */
type EventScope<K extends keyof ObserverEvents> = ObserverEvents[K][0];

export class ObserverService extends Observer {
	private static buildObserverConfig(options: ObserverServiceOptions): ConstructorParameters<typeof Observer>[0] {
		if (options.uploader && !options.samplesStorePath) {
			logger.warn('buildObserverConfig() ignoring --samplesUploadUri, nothing to upload without --samplesStorePath');

			options.uploader = undefined;
		}

		return {
			createClientSink: options.samplesStorePath
				? createJsonlFileSinkFactory({ directory: options.samplesStorePath })
				: undefined,
			closeCallIfEmptyForMs: 5 * 60 * 1000, // 5 minutes
			closeClientIfIdleForMs: 1 * 60 * 1000, // 1 minute,
			createRemoteTrackResolver: createDefaultMediasoupRemoteTrackResolverFactory(),
		};
	}

	public constructor(public options: ObserverServiceOptions) {
		super(ObserverService.buildObserverConfig(options));

		logger.debug('constructor()');

		if (options.samplesStorePath && options.uploader) {
			logger.info(
				'observertc sample collection enabled [storePath: %s, deleteAfterUpload: %s]',
				options.samplesStorePath,
				String(options.uploader.deleteAfterUpload)
			);
		} else if (options.samplesStorePath) {
			logger.info(
				'observertc sample collection enabled, uploads disabled [storePath: %s]',
				options.samplesStorePath
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
		logger.debug('addDataConsumer() [id: %s]', dataConsumer.id);

		const onMessage = (payload: Buffer | string) => {
			try {
				const text = Buffer.isBuffer(payload)
					? payload.toString('utf8')
					: String(payload);

				const sample = JSON.parse(text);

				this.accept(sample);
			} catch (error) {
				logger.error(
					{ err: error },
					'addDataConsumer() error accepting sample [dataConsumerId: %s]',
					dataConsumer.id
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

	/**
	 * Wire up the subscriptions. Each handler is an arrow class property, so it
	 * stays bound when passed by reference here; those run immediately after
	 * `super()`, before this method is called.
	 *
	 * Only the first group is unconditional. The rest exists solely to produce
	 * artifacts for the uploader, and to keep the call appData those artifacts
	 * are built from — `ObservedCallAppData` is read nowhere else. With nowhere to
	 * send anything, none of that work is worth doing, so we do not subscribe at
	 * all rather than subscribe and bail out per event.
	 */
	private setupObserverEvents(): void {
		// Diagnostics and observer wiring, worth having either way.
		this.on('peer-connection-added', this.handlePeerConnectionAdded);
		this.on('mediasoup-router-added', this.handleMediasoupRouterAdded);
		this.on('mediasoup-router-matched-with-peer-connection', this.handleMediasoupRouterMatched);

		// Not one of our own events: mediasoup's global observer is how we learn
		// about routers, so they can be attached to the calls that use them.
		mediasoup.observer.on('newworker', this.handleNewMediasoupWorker);

		// Subscribed whenever there is a store path, not only when uploading: the
		// sink is what writes the file, and its completion is worth reporting even
		// when nothing is sent anywhere.
		if (this.options.samplesStorePath) {
			this.on('client-sink-created', this.handleClientSinkCreated);
		}

		if (this.options.uploader) {
			this.on('client-added', this.handleClientAdded);
			this.on('client-updated', this.handleClientUpdated);
			this.on('call-closed', this.handleCallClosed);
			this.on('mediasoup-router-removed', this.handleMediasoupRouterRemoved);
		}
	}

	/**
	 * Upload the client's JSONL file once its sink closes, i.e. once the observed
	 * client has left and nothing more will be written.
	 */
	private handleClientSinkCreated = ({ sink, observedCall, observedClient }: EventScope<'client-sink-created'>): void => {
		const sourcePath = sink instanceof JsonlFileSink ? sink.path : undefined;

		if (!sourcePath) return;

		sink.once('close', async () => {
			// The sink is closed, so the file is complete. Size is included because a
			// 0-byte file is the tell-tale of a client that connected but never sent
			// a sample, which otherwise looks identical to success.
			const bytes = await stat(sourcePath)
				.then((s) => s.size)
				.catch(() => -1);

			const { uploader } = this.options;

			if (!uploader) return logger.info('sample file written [clientId: %s, bytes: %d, path: %s]', observedClient.clientId, bytes, sourcePath);

			const call = observedCall as ObservedCall<ObservedCallAppData>;
			const sampleAttachments = observedClient.attachments as Record<string, unknown> | undefined;
			const roomId = safeKeySegment(call.appData?.roomId ?? sampleAttachments?.['roomId'], 'unknown-room');
			const targetKey = `${roomId}/${call.callId}/${observedClient.clientId}.jsonl`;

			try {
				await uploader.upload({
					key: targetKey,
					sourcePath,
					contentType: 'application/x-ndjson',
				});

				logger.info('sample file uploaded [key: %s, bytes: %d] from %s, deletedAfterUpload: %s', targetKey, bytes, sourcePath, String(uploader.deleteAfterUpload));

				if (uploader.deleteAfterUpload) {
					await this.deleteUploadedFile(sourcePath, targetKey);
				}
			} catch (error) {
				logger.error({ err: error }, 'handleClientSinkCreated() upload failed [key: %s]', targetKey);
			}
		});
	};

	private async deleteUploadedFile(path: string, key: string): Promise<void> {
		try {
			await unlink(path);
		} catch (error) {
			logger.warn({ err: error }, 'deleteUploadedFile() delete failed [key: %s, path: %s]', key, path);
		}
	}

	/** Seed the call's appData entry for a client that just joined. */
	private handleClientAdded = (scope: EventScope<'client-added'>): void => {
		const observedCall = scope.observedCall as ObservedCall<ObservedCallAppData>;

		observedCall.appData.clients[scope.observedClient.clientId] = {

		};
	};

	/** Lift roomId and displayName out of client sample attachments onto the call. */
	private handleClientUpdated = ({ observedClient }: EventScope<'client-updated'>): void => {
		const observedCall = observedClient.call as ObservedCall<ObservedCallAppData>;

		if (!observedCall.appData?.roomId && observedClient.attachments?.roomId) {

			observedCall.appData.roomId = observedClient.attachments.roomId as string;

			logger.debug('handleClientUpdated() set roomId [callId: %s, roomId: %s]', observedClient.call.callId, observedCall.appData.roomId);
		}

		// `client-added` may never have been seen for this client, in which case the
		// entry is absent. Writing through it would throw, and an uncaught throw here
		// takes the whole media node down via the process-level handler in server.ts.
		const clientEntry = observedCall.appData?.clients?.[observedClient.clientId];

		if (clientEntry && observedClient.attachments?.displayName) {
			clientEntry.displayName = observedClient.attachments.displayName as string;
		}
	};

	private handlePeerConnectionAdded = ({ observedClient, observedCall, observedPeerConnection }: EventScope<'peer-connection-added'>): void => {
		logger.debug('handlePeerConnectionAdded() [callId: %s, clientId: %s, peerConnectionId: %s]', observedCall.callId, observedClient.clientId, observedPeerConnection.peerConnectionId);
	};

	/** Upload the call summary once the call is over. */
	private handleCallClosed = async (scope: EventScope<'call-closed'>): Promise<void> => {
		const observedCall = scope.observedCall as ObservedCall<ObservedCallAppData>;

		logger.debug('handleCallClosed() [callId: %s, appData: %o]', observedCall.callId, observedCall.appData);

		const { uploader } = this.options;

		// Nothing reads the summary when there is nowhere to send it, so bail out
		// before paying to serialise it.
		if (!uploader || !observedCall.appData) return;

		try {
			const sample = JSON.stringify({
				...observedCall.appData,
				numberOfIssues: observedCall.numberOfIssues,
				clientsUsedTurn: [ ...observedCall.clientsUsedTurn ],
			});

			const callRoomId = safeKeySegment(observedCall.appData.roomId, 'unknown-room');
			const targetKey = `${callRoomId}/${observedCall.callId}/call-summary.json`;

			await uploader.upload({
				key: targetKey,
				body: sample,
				contentType: 'application/json',
			});

			logger.info('sample file uploaded [key: %s] from call %s', targetKey, observedCall.callId);

		} catch (error) {
			logger.error({ err: error }, 'handleCallClosed() upload failed [callId: %s]', observedCall.callId);
		}
	};

	/** Observe every router each mediasoup worker creates. */
	private handleNewMediasoupWorker = (worker: mediasoup.types.Worker): void => {
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
	};

	private handleMediasoupRouterAdded = ({ observedMediasoupRouter }: EventScope<'mediasoup-router-added'>): void => {
		logger.debug('handleMediasoupRouterAdded() [routerId: %s, sample: %o]', observedMediasoupRouter.router.id, observedMediasoupRouter.sample);
	};

	/** Remember which call a router belongs to, and tag the client with its id. */
	private handleMediasoupRouterMatched = ({ observedClient, observedCall, observedMediasoupRouter }: EventScope<'mediasoup-router-matched-with-peer-connection'>): void => {
		observedMediasoupRouter.appData = {
			observedCall,
		};

		logger.debug('handleMediasoupRouterMatched() [routerId: %s, callId: %s, clientId: %s]', observedMediasoupRouter.router.id, observedCall.callId, observedClient.clientId);

		observedClient.injectAttachment({
			routerId: observedMediasoupRouter.router.id,
		});

		const callAppData = (observedCall as ObservedCall<ObservedCallAppData>).appData;

		if (callAppData?.routerIds && !callAppData.routerIds.includes(observedMediasoupRouter.router.id)) {
			callAppData.routerIds.push(observedMediasoupRouter.router.id);
		}
	};

	/** Upload the router's own sample once it goes away. */
	private handleMediasoupRouterRemoved = async ({ observedMediasoupRouter }: EventScope<'mediasoup-router-removed'>): Promise<void> => {
		logger.debug('handleMediasoupRouterRemoved() [routerId: %s, sample: %o, appData: %o]', observedMediasoupRouter.router.id, observedMediasoupRouter.sample, observedMediasoupRouter.appData);

		const { uploader } = this.options;

		// The router sample can be sizeable; do not stringify it for nobody.
		if (!uploader || !observedMediasoupRouter.appData?.observedCall) return;

		const observedCall = observedMediasoupRouter.appData.observedCall as ObservedCall<ObservedCallAppData>;

		if (!observedCall.appData.roomId) return;

		try {
			const sample = JSON.stringify(observedMediasoupRouter.sample);
			const roomId = safeKeySegment(observedCall.appData.roomId, 'unknown-room');
			const targetKey = `${roomId}/${observedCall.callId}/mediasoup-router-${observedMediasoupRouter.router.id}.json`;

			await uploader.upload({
				key: targetKey,
				body: sample,
				contentType: 'application/json',
			});

			logger.info('sample file uploaded [key: %s] for router %s', targetKey, observedMediasoupRouter.router.id);
		} catch (error) {
			logger.error({ err: error }, 'handleMediasoupRouterRemoved() upload failed [routerId: %s]', observedMediasoupRouter.router.id);
		}
	};

	/**
	 * `mediasoup.observer` is a process-level singleton that outlives this
	 * service, so the 'newworker' subscription has to be released explicitly or
	 * it keeps the closed ObserverService reachable.
	 */
	public override close(): void {
		mediasoup.observer.off('newworker', this.handleNewMediasoupWorker);

		this.off('peer-connection-added', this.handlePeerConnectionAdded);
		this.off('mediasoup-router-added', this.handleMediasoupRouterAdded);
		this.off('mediasoup-router-matched-with-peer-connection', this.handleMediasoupRouterMatched);

		if (this.options.samplesStorePath) {
			this.off('client-sink-created', this.handleClientSinkCreated);
		}

		if (this.options.uploader) {
			this.off('client-added', this.handleClientAdded);
			this.off('client-updated', this.handleClientUpdated);
			this.off('call-closed', this.handleCallClosed);
			this.off('mediasoup-router-removed', this.handleMediasoupRouterRemoved);
		}

		super.close();
	}

}
