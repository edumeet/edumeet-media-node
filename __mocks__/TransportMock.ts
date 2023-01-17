import { Consumer } from 'mediasoup/node/lib/Consumer';

export default class TransportMock {
	#consumer;

	constructor(consumer?: Consumer) {
		if (consumer) {
			this.#consumer = consumer;
		}
	}

	consume = async () => {
		return this.#consumer ? this.#consumer : {};
	};
	consumeData = async () => {
		return this.#consumer ? this.#consumer : {};
	};
	id = 'id';
}