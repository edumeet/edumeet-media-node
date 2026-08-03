import { EventEmitter } from 'events';
import { Consumer, Router, RouterOptions } from 'mediasoup/types';

export default class WorkerMock extends EventEmitter {
	observer;
	appData = {
		routersByRoomId: new Map<string, Promise<Router>>(),
		consumers: new Map<string, Consumer>()
	};
	pid;
	
	constructor(
		workerObserver: EventEmitter,
		pid: number,
		consumersSize = 0
	) {
		super();
		this.observer = workerObserver;		
		this.pid = pid;
		this.#setConsumers(consumersSize);
	}

	#setConsumers(amount: number) {
		this.appData.consumers.clear();
		for (let i = 0; i < amount; i++) {
			this.appData.consumers.set(i.toString(), {} as unknown as Consumer);
		}
	}

	close = jest.fn();

	getResourceUsage = jest.fn().mockReturnValue({
		value: {
			/* eslint-disable camelcase */
			ru_utime: 0.2,
			ru_stime: 0.2
			/* eslint-enable camelcase */
		}
	});

	createWebRtcServer = jest.fn();
	
	createRouter = ({ mediaCodecs, appData }: RouterOptions) => {
		if (appData)
			return { 
				mediaCodecs: mediaCodecs,
				id: appData.roomId,
				close: jest.fn(), 
				// MediaService stashes the result on router.appData.directTransport.
				createDirectTransport: jest.fn().mockResolvedValue({ id: 'direct-transport', close: jest.fn() }),
				rtpCapabilities: {
					headerExtensions: []
				},
				observer: this.observer,
				appData: {
					workerPid: this.pid,
				}
			};
	};
	
}