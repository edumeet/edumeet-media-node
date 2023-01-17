import { List } from 'edumeet-common';
import EventEmitter from 'events';
import { Worker } from 'mediasoup/node/lib/Worker';

export default class MediaServiceMock extends EventEmitter {
	workers: List<Worker>;
	ip = '1.1.1.1';
	announcedIp = '2.2.2.2';
	maxIncomingBitrate = 100;
	maxOutgoingBitrate = 100;

	constructor() {
		super();
		this.workers = List<Worker>();
	}

	getMetrics = () => {
		return { 1: { consumers: 10, routers: 2 } };
	};

	getRouter = jest.fn();
}
