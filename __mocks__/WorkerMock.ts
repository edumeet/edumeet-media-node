import { Consumer } from 'mediasoup/node/lib/Consumer';
import { EnhancedEventEmitter } from 'mediasoup/node/lib/EnhancedEventEmitter';
import { Router, RouterOptions } from 'mediasoup/node/lib/Router';

export default class WorkerMock extends EnhancedEventEmitter {
	observer;
	appData = {
		routersByRoomId: new Map<string, Promise<Router>>(),
		consumers: new Map<string, Consumer>()
	};
	pid;
	
	constructor(
		workerObserver: EnhancedEventEmitter,
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