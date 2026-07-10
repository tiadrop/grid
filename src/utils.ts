export type GetXYFunc<T> = (x: number, y: number) => T;

export type Source2D<T> = {
	width: number;
	height: number;
	get: GetXYFunc<T>;
}

export class OrderedQueue<T> {
	private queue: {value: T, priority: number}[] = [];
	constructor(
		private getCost: (value: T) => number,
		...values: T[]
	) {
		values.forEach(v => this.add(v));
	}
	add(value: T) {
		const priority = this.getCost(value);
		const item = {value, priority};
		
		let low = 0, high = this.queue.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (this.queue[mid].priority > priority) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		
		this.queue.splice(low, 0, item);
	}
	get length() {
		return this.queue.length;
	}
	take() {
		if (this.queue.length == 0) throw new Error("Queue is empty");
		return this.queue.pop()!.value;
	}
}
