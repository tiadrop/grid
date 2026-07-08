import { Pipe2D } from "@xtia/pipe2d";
import { Angle, angleToRadians, GetXYFunc, OrderedQueue, Source2D } from "./utils.js";

type ChangeEvent<T> = {
	changedCells: Set<Cell<T>>;
}

type EventMap<T> = {
	change: ChangeEvent<T>;
}

type BatchState<T> = {
	level: number;
	changedCells: Set<Cell<T>>;
}

type PathFindOptions<T> = {
	maxCost?: number;
	allowDiagonal?: boolean;
	onVisit?: (info: {cell: Cell<T>, cost: number}) => void;
	shortcutMap?: Source2D<Cell<T>[] | undefined>;
}

type CostMapOptions<T> = PathFindOptions<T> & {
	stopAt?: [number, number] | Cell<T>;
}

export enum TraversalType {
	cardinal,
	diagonal,
	shortcut
}

type CostFunc<T> = (cell: Cell<T>, context: {
	traversalType: TraversalType;
	from: Cell<T>;
}) => number

export enum Visibility {
	visible,
	hidden,
	wall
}

export class Cell<T> {
	constructor(
		public readonly x: number,
		public readonly y: number,
		private gridView: Grid<T>,
	) {}

	get value() {
		return this.gridView.get(this.x, this.y);
	}

	set value(v) {
		this.gridView.set(this.x, this.y, v);
	}

	getNeighbours(includeDiagonals: boolean = false) {
		const offsets = includeDiagonals 
			? [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
			: [[-1,0],[1,0],[0,-1],[0,1]];

		return offsets
			.map(([ox, oy]) => [ox + this.x, oy + this.y])
			.filter(([tx, ty]) => tx >= 0 && tx < this.gridView.width && ty >= 0 && ty < this.gridView.height)
			.map(([tx, ty]) => this.gridView.cells.get(tx, ty));
	}

	look(xDelta: number, yDelta: number) {
		const [x, y] = [this.x + xDelta, this.y + yDelta];
		if (x < 0 || x >= this.gridView.width || y < 0 || y >= this.gridView.height) return undefined;
		return this.gridView.cells.get(xDelta + this.x, yDelta + this.y);
	}

	findPath(
		target: Cell<T> | [number, number],
		getCost: CostFunc<T>,
		options: PathFindOptions<T> = {}
	): Cell<T>[] | null {
		const targetXY = Array.isArray(target)
			? target
			: [target.x, target.y] as [number, number];

		const pathMap = this.calculateCosts(getCost, {
			stopAt: targetXY,
			allowDiagonal: options.allowDiagonal,
			maxCost: options.maxCost,
		}, true);

		return pathMap?.get(...targetXY);
	}

	getPathMap(
		getCost: CostFunc<T>,
		options: PathFindOptions<T> = {}
	) {
		return this.calculateCosts(
			getCost,
			options,
			true,
		)
	}

	getCostMap(
		getCost: CostFunc<T>,
		options: CostMapOptions<T> = {}
	) {
		return this.calculateCosts(getCost, options)
	}

	private calculateCosts(
		getCost: CostFunc<T>,
		options: CostMapOptions<T>,
	): Pipe2D<number>
	private calculateCosts(
		getCost: CostFunc<T>,
		options: CostMapOptions<T>,
		asPathMap: true,
	): Pipe2D<Cell<T>[] | null>
	private calculateCosts(
		getCost: CostFunc<T>,
		options: CostMapOptions<T>,
		asPathMap: boolean = false
	): Pipe2D<number> | Pipe2D<Cell<T>[] | null> {
		const visited = new Set<Cell<T>>();
		const costs = new Map<Cell<T>, number>();
		const maxCost = options.maxCost ?? Infinity;
		const pathInfo = asPathMap
			? new Map<Cell<T>, Cell<T>>()
			: null;
		
		costs.set(this, 0);

		const queue = new OrderedQueue<Cell<T>>(cell => costs.get(cell) ?? Infinity, this);

		const targetCell = Array.isArray(options.stopAt)
			? this.gridView.cells.get(options.stopAt[0], options.stopAt[1])
			: options.stopAt;

		if (targetCell && targetCell.gridView !== this.gridView) {
			throw new Error("Target cell belongs to a different Grid");
		}
		
		while (queue.length > 0) {
			const current = queue.take();
			options.onVisit?.({cell: current, cost: costs.get(current)!});
			
			if (visited.has(current)) continue;
			visited.add(current);
			
			if (targetCell && current === targetCell) {
				break;
			}
			
			const currentCost = costs.get(current)!;
			
			const neighbours = current.getNeighbours(options.allowDiagonal).map(cell => ({
				traversalType: cell.x == current.x && cell.y == current.y ? TraversalType.cardinal : TraversalType.diagonal,
				cell
			}));
			if (options.shortcutMap) {
				const shortcuts = options.shortcutMap.get(current.x, current.y)?.map(cell => ({
					traversalType: TraversalType.shortcut,
					cell
				}));
				if (shortcuts) neighbours.push(...shortcuts);
			}
			
			neighbours.forEach(n => {
				if (visited.has(n.cell)) return;
				
				const moveCost = getCost(n.cell, {
					traversalType: n.traversalType,
					from: current,
				});
				if (moveCost === Infinity) return;
				
				const newCost = currentCost + moveCost;
				const oldCost = costs.get(n.cell) ?? Infinity;
				
				if (newCost < oldCost && newCost <= maxCost) {
					costs.set(n.cell, newCost);
					pathInfo?.set(n.cell, current);
					queue.add(n.cell);
				}
			});
		}

		if (pathInfo) {
			// only cache directly queried paths
			// but if a cached path is encountered during a resolution, reuse it
			const cache = new Map<Cell<T>, Cell<T>[]>();
			return this.gridView.cells.map(targetCell => {
				if (targetCell === this) return [];
				if (cache.has(targetCell)) return cache.get(targetCell)!;
				if (!pathInfo.has(targetCell)) return null;

				let current: Cell<T> = targetCell;
				let path: Cell<T>[] = [];
				
				while (current !== this) { // 'this' being the parent cell of this pathmap (path start)
					if (cache.has(current)) {
						path.unshift(...cache.get(current)!);
						cache.set(targetCell, path);
						return path;
					}
					path.unshift(current);
					current = pathInfo.get(current)!;
				}
				
				cache.set(targetCell, path);
				return path;
			});
		}

		return this.gridView.cells.map((c => costs.get(c) ?? Infinity))
			.strict();
	}

	*getLineTo(target: { x: number, y: number } | [number, number]): IterableIterator<Cell<T>> {
		const [targetX, targetY] = Array.isArray(target)
			? target
			: [target.x, target.y];
		
		if (this.x === targetX && this.y === targetY) {
			yield this;
			return;
		}
		
		const dx = Math.abs(targetX - this.x);
		const dy = Math.abs(targetY - this.y);
		const sx = this.x < targetX ? 1 : -1;
		const sy = this.y < targetY ? 1 : -1;
		let err = dx - dy;
		
		let x = this.x;
		let y = this.y;
		
		while (true) {
			const cell = this.gridView.cells.get(x, y);
			if (cell) {
				yield cell;
			}
			
			// Check if we've reached the target
			if (x === targetX && y === targetY) {
				break;
			}
			
			const e2 = 2 * err;
			
			if (e2 > -dy) {
				err -= dy;
				x += sx;
			}
			
			if (e2 < dx) {
				err += dx;
				y += sy;
			}
		}
	}

	createVisibilityMap(
		isWall: (cell: Cell<T>) => boolean,
		maxDistance: number = Infinity
	): Pipe2D<Visibility> {
		return new Pipe2D<Visibility>(
			this.gridView.width,
			this.gridView.height,
			(x, y) => {
				const distance = getDistance(this, { x, y });
				
				if (distance > maxDistance) {
					return Visibility.hidden;
				}
				
				for (const cell of this.getLineTo({ x, y })) {
					if (isWall(cell)) {
						// Skip the starting cell (viewer's position)
						if (cell.x === this.x && cell.y === this.y) {
							continue;
						}

						if (cell.x === x && cell.y === y) {
							return Visibility.wall;
						}
						return Visibility.hidden;
					}
				}
				
				return Visibility.visible;
			}
		);
	}

}

function getDistance(c1: {x: number, y: number}, c2: {x: number, y: number}): number {
    return Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));
}

export class Grid<T> {

	private parentGet: GetXYFunc<T>;
	private parentSet: (x: number, y: number, value: T) => void;
	readonly cells = new Pipe2D(this.width, this.height, (x, y) => {
		return new Cell(x, y, this)
	}).strict().withCache();

	protected constructor(
		public readonly width: number,
		public readonly height: number,
		get: GetXYFunc<T>,
		set: (x: number, y: number, value: T) => void,
		private batch: (cb: () => void) => void,
	) {
		this.parentGet = get;
		this.parentSet = set;
	}

	private writeMasks: {mask: Source2D<boolean>}[] = [];


	pipe = new Pipe2D(this);

	private isWritable(x: number, y: number) {
		return !this.writeMasks.some(mask => !mask.mask.get(x, y));
	}

	batchUpdate(fn: () => void) {
		this.batch(fn);
	}

	get(x: number, y: number) {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
			throw new RangeError("Coordinates out of bounds");
		}
		return this.parentGet(x, y);
	}

	set(x: number, y: number, value: T) {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
			throw new RangeError("Coordinates out of bounds");
		}
		if (this.isWritable(x, y)) this.parentSet(x, y, value);
	}

	trySet(x: number, y: number, value: T): boolean {
    	if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    	this.set(x, y, value);
    	return true;
	}

	fill(value: T) {
		this.batchUpdate(() => {
			for (let y = 0; y < this.height; y++) {
				for (let x = 0; x < this.width; x++) {
					const tx = x;
					const ty = y;
					this.trySet(tx, ty, value);
				}
			}
		});
	}

	paste(x: number, y: number, source: Source2D<T>) {
		const cachedSource = new GridBase(source);
		this.batchUpdate(() => {
			for (let oy = 0; oy < source.height; oy++) {
				for (let ox = 0; ox < source.width; ox++) {
					const tx = ox + x;
					const ty = oy + y;
					this.trySet(tx, ty, cachedSource.get(ox, oy));
				}
			}
		});
	}

	applyWriteMask(mask: Source2D<boolean>) {
		const unique = {mask};
		this.writeMasks.push(unique);
		return () => {
			const idx = this.writeMasks.indexOf(unique);
			if (idx == -1) throw new Error("Mask was not present");
			this.writeMasks.splice(idx, 1);
		}
	}

	*[Symbol.iterator](): IterableIterator<{x: number, y: number, value: T}> {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				yield {x, y, value: this.get(x, y)};
			}
		}
	}

	forEach(callback: (value: T, x: number, y: number) => void): void {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				callback(this.get(x, y), x, y);
			}
		}
	}

	getVisibilityMap(
		originX: number,
		originY: number,
		maxDistance: number,
		isWall: (value: T, x: number, y: number) => boolean,
		options?: {
			startAngle?: Angle;
			endAngle?: Angle;
			includeWalls?: boolean;
			angleStep?: Angle;
		}
	): Pipe2D<boolean> {
		const {
			startAngle = {asTurns: 0},
			endAngle = {asTurns: 1},
			includeWalls = false,
			angleStep = {asDegrees: 1}
		} = options || {};
		
		const visibilityGrid = new GridBase<boolean>(this.width, this.height, () => false);
		
		const startRad = angleToRadians(startAngle);
		const endRad = angleToRadians(endAngle);
		const stepRad = angleToRadians(angleStep);
		
		const totalAngle = endRad > startRad 
			? endRad - startRad 
			: endRad + (2 * Math.PI) - startRad;
		
		const effectiveStepRad = Math.max(0.001, Math.min(stepRad, totalAngle));
		const steps = Math.ceil(totalAngle / effectiveStepRad);
		
		for (let i = 0; i <= steps; i++) {
			const angle = startRad + i * effectiveStepRad;
			if (angle > endRad && i > 0) break; // Don't overshoot
			
			const endX = Math.round(originX + maxDistance * Math.cos(angle));
			const endY = Math.round(originY + maxDistance * Math.sin(angle));
			
			let x0 = originX;
			let y0 = originY;
			let x1 = endX;
			let y1 = endY;
			
			const dx = Math.abs(x1 - x0);
			const dy = Math.abs(y1 - y0);
			const sx = x0 < x1 ? 1 : -1;
			const sy = y0 < y1 ? 1 : -1;
			let err = dx - dy;
			
			while (true) {
				if (x0 < 0 || x0 >= this.width || y0 < 0 || y0 >= this.height) {
					break;
				}
				
				const isWallCell = isWall(this.get(x0, y0), x0, y0);
				
				if (isWallCell) {
					if (includeWalls) {
						visibilityGrid.set(x0, y0, true);
					}
					break;
				} else {
					visibilityGrid.set(x0, y0, true);
				}
				
				if (x0 === x1 && y0 === y1) break;
				
				const e2 = 2 * err;
				if (e2 > -dy) {
					err -= dy;
					x0 += sx;
				}
				if (e2 < dx) {
					err += dx;
					y0 += sy;
				}
			}
		}
		
		return visibilityGrid.pipe;
	}

	getFloodMap(
		startX: number,
		startY: number,
		predicate: (value: T, x: number, y: number, initialValue: T) => boolean,
		options?: {
			includeDiagonals?: boolean;
			maxDistance?: number;
		}
	): Pipe2D<boolean> {
		const {
			includeDiagonals = false,
			maxDistance = Infinity
		} = options || {};
		
		const result = new GridBase<boolean>(this.width, this.height, () => false);
		
		const startValue = this.get(startX, startY);
		if (!predicate(startValue, startX, startY, startValue)) {
			return result.pipe;
		}
		
		const queue: Array<[number, number, number]> = [[startX, startY, 0]]; // [x, y, distance]
		result.set(startX, startY, true);
		
		while (queue.length > 0) {
			const [x, y, distance] = queue.shift()!;
			if (distance >= maxDistance) continue;

			this.cells.get(x, y).getNeighbours(includeDiagonals)
				.forEach(neighbour => {
					if (result.get(neighbour.x, neighbour.y)) return;
					if (predicate(neighbour.value, neighbour.x, neighbour.y, startValue)) {
						result.set(neighbour.x, neighbour.y, true);
						queue.push([neighbour.x, neighbour.y, distance + 1]);
					}
				});
		}
		
		return result.pipe;
	}

	combine<U, R>(aux: Source2D<U>, cb: (source: T, aux: U) => R) {
		const width = Math.min(this.width, aux.width);
		const height = Math.min(this.height, aux.height);
		return new GridBase(width, height, (x, y) => {
			return cb(this.get(x, y), aux.get(x, y))
		})
	}

	map<U>(
		read: (initial: T, x: number, y: number) => U,
		write: (local: U, x: number, y: number) => T
	) {
		return new Grid(
			this.width,
			this.height,
			(x, y) => read(this.parentGet(x, y), x, y),
			(x, y, value) => this.parentSet(x, y, write(value, x, y)),
			fn => this.batch(fn),
		)
	}

	region(x: number, y: number, width: number, height: number) {
		return new Grid(
			width,
			height,
			(tx, ty) => {
				return this.parentGet(tx + x, ty + y)
			},
			(tx, ty, value) => {
				if (tx < 0 || ty < 0 || tx >= width || ty >= height) throw new Error("Out of bounds");
				this.parentSet(tx + x, ty + y, value)
			},
			fn => this.batch(fn),
		)
	}

	static init<T>(width: number, height: number, initCell: () => T) {
		return new GridBase(width, height, initCell);
	}

	static from<T>(source: Source2D<T>) {
		return new GridBase(source);
	}

	static solid<T>(width: number, height: number, fillValue: T) {
		return new GridBase(Pipe2D.solid(fillValue, width, height));
	}
}

export class GridBase<T> extends Grid<T> {
	private data: T[];
	private eventHandlers: {
		[k in keyof EventMap<T>]?: {fn: (ev: EventMap<T>[k]) => void}[]
	} = {};

	private triggerEvent<K extends keyof EventMap<T>>(name: K, data: EventMap<T>[K]) {
		this.eventHandlers[name]?.forEach(obj => obj.fn(data));
	}
	private batchState: null | BatchState<T> = null;

	batchUpdate(fn: () => void) {
		if (this.batchState) {
			this.batchState.level++;
		} else {
			this.batchState = {
				level: 1,
				changedCells: new Set()
			}
		}
		fn();
		this.batchState.level--
		if (this.batchState.level == 0) {
			const changed = this.batchState.changedCells;
			this.batchState = null;
			this.triggerChange(changed);
		}
	}

	constructor(source: Source2D<T>)
	constructor(width: number, height: number, cellInit: GetXYFunc<T>)
	constructor(widthOrSource: number | Source2D<T>, height?: number, cellInit?: GetXYFunc<T>) {
		const source = typeof widthOrSource == "object"
			? widthOrSource
			: {
				width: widthOrSource,
				height: height!,
				get: cellInit!
			};

		super(
			source.width,
			source.height,
			(x, y) => this.data[this.xyToIndex(x, y)],
			(x, y, value) => this._set(x, y, value),
			fn => this.batchUpdate(fn),
		);

		this.data = Array.from({length: source.width * source.height}, (_, i) => {
			const x = i % source.width;
			const y = Math.floor(i / source.width);
			return source.get(x, y);
		});
	}

	on<K extends keyof EventMap<T>>(eventName: K, handler: (data: EventMap<T>[K]) => void) {
		const unique = {fn: handler};
		if (!this.eventHandlers[eventName]) this.eventHandlers[eventName] = [];
		this.eventHandlers[eventName]!.push(unique);
		return () => {
			const idx = this.eventHandlers[eventName]!.indexOf(unique);
			if (idx === -1) throw new Error("Event handler was already retired");
			this.eventHandlers[eventName]!.splice(idx, 1);
		}
	}

	private xyToIndex(x: number, y: number) {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            throw new Error(`Coordinates out of bounds: (${x}, ${y})`);
        }
		return y * this.width + x;
	}

	private _set(x: number, y: number, value: T) {
		const idx = this.xyToIndex(x, y);
		if (this.data[idx] === value) return;
		if (this.batchState) {
			this.batchState.changedCells.add(this.cells.get(x, y));
			return;
		}
		this.data[this.xyToIndex(x, y)] = value;
		if (this.eventHandlers.change) {
			this.triggerChange(new Set([this.cells.get(x, y)]));
		}
	}

	private triggerChange(changed: Set<Cell<T>>) {
		this.triggerEvent("change", {changedCells: changed});
	}
}
