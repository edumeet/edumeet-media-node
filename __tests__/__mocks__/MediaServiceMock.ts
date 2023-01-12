import { List } from 'edumeet-common';
import EventEmitter from 'events';
import { Worker } from 'mediasoup/node/lib/Worker';

export default class MediaServiceMock extends EventEmitter {
	workers: List<Worker>;

	constructor() {
		super();
		this.workers = List<Worker>();
	}
}
