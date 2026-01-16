import EventEmitter from 'events';
// import { Consumer } from 'mediasoup/node/lib/Consumer';
// import { Producer } from 'mediasoup/node/lib/Producer';

type Consumer = any;
type Producer = any;

export default class TransportMock {
	observer;
	#consumer;
	#producer;
	id = 'id';
	iceParameters = 'ice';
	iceCandidates = 'ice';
	dtlsParameters = 'dtls';
	sctpParameters = 'sctp';
	appData = {
		remoteClosed: false
	};
	tuple = {
		localIp: '127.0.0.1',
		localPort: 1234
	};

	constructor(consumer?: Consumer, producer?: Producer, observer?: EventEmitter) {
		if (consumer) {
			this.#consumer = consumer;
		}
		if (producer) {
			this.#producer = producer;
		}
		if (observer) {
			this.observer = observer;
		}
	}

	consume = async () => {
		return this.#consumer ? this.#consumer : {};
	};
	consumeData = async () => {
		return this.#consumer ? this.#consumer : {};
	};
	produce = async () => {
		return this.#producer ? this.#producer : {};
	};
	produceData = async () => {
		return this.#producer ? this.#producer : {};
	};
	connect = jest.fn();
	close = jest.fn();
	restartIce = jest.fn();
	setMaxIncomingBitrate = jest.fn();
	setMaxOutgoingBitrate = jest.fn();
}