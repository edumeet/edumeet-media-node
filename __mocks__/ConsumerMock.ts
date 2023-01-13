import EventEmitter from 'events';

type appData = {
    remoteClosed: boolean
}

export default class ConsumerMock {
	id = 'id';
	kind = 'video';
	rtpParameters = 'rtp';
	producerPaused = false;
	observer: EventEmitter;
	appData: appData = { remoteClosed: false };

	constructor(observer: EventEmitter) {
		this.observer = observer;
	}
}