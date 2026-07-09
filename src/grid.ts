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

type VisibilityOptions = {
	maxDistance?: number;
	boundariesVisible?: boolean;
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

export class Cell<T> {
	constructor(
		public readonly x: number,
		public readonly y: number,
		private gridView: Grid<T>,
	) {}

	/**
	 * The value held in this cell.
	 */
	get value() {
		return this.gridView.get(this.x, this.y);
	}

	set value(v) {
		this.gridView.set(this.x, this.y, v);
	}

	/**
	 * Returns an array of neighbouring cells.
	 * @param includeDiagonals 
	 * @returns Neighbouring cells
	 */
	getNeighbours(includeDiagonals: boolean = false) {
		const offsets = includeDiagonals 
			? [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
			: [[-1,0],[1,0],[0,-1],[0,1]];

		return offsets
			.map(([ox, oy]) => [ox + this.x, oy + this.y])
			.filter(([tx, ty]) => tx >= 0 && tx < this.gridView.width && ty >= 0 && ty < this.gridView.height)
			.map(([tx, ty]) => this.gridView.cells.get(tx, ty));
	}

	/**
	 * Gets a cell located at a position relative to this one.
	 * 
	 * If the relative position is outside of the grid's bounds, `undefined` is returned.
	 * @param xDelta X offset
	 * @param yDelta Y offset
	 * @returns Relatively-positioned cell, if it exists, otherwise undefined.
	 */
	look(xDelta: number, yDelta: number) {
		const [x, y] = [this.x + xDelta, this.y + yDelta];
		if (x < 0 || x >= this.gridView.width || y < 0 || y >= this.gridView.height) return undefined;
		return this.gridView.cells.get(xDelta + this.x, yDelta + this.y);
	}

	/**
	 * Computes the optimal path from this Cell to another, based on a cell costing predicate.
	 * @param target Destination cell or [x, number] coordinates
	 * @param getCost Function that returns the movement cost for traversing a cell. Return `Infinity` for impassable cells.
	 * @param options Configuration for pathfinding behavior (max cost, diagonal movement, etc).
	 * @returns Optimal path as array of Cells, or null if no path exists.
	 */
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

	/**
	 * Computes a map of optimal paths from this cell, based on a cell costing predicate.
	 * @param getCost Function that returns the movement cost for traversing a cell
	 * @param options Configuration for pathfinding behavior (max cost, diagonal movement, etc)
	 * @returns Map containing optimal paths to all reachable cells. Unreachable cells are mapped as `null`.
	 */
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

	/**
	 * Computes a map of optimal path costs from this Cell, based on a cell costing predicate.
	 * @param getCost Function that returns the movement cost for traversing a cell
	 * @param options Configuration for pathfinding behavior (max cost, diagonal movement, etc)
	 * @returns Map containing costs for all reachable cells. Unreachable cells are costed `Infinity`.
	 */
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

		return this.gridView.cells.map(costs, () => Infinity)
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

	/**
	 * Creates a Pipe2D of values representing each location's visibility from this cell, depending on the user-provided `isClear` predicate.
	 * 
	 * The resulting visibility map is live; changes to the Grid can affect subsequent queries to the map.
	 * @param isClear Function that returns true for cells that allow vision.
	 * @param options Optional configuration; Euclidian visibility distance, boundaries visible.
	 * @returns Map of every cell's visibility from this cell
	 */
	createVisibilityMap(
		isClear: (cell: Cell<T>) => boolean,
		options: VisibilityOptions = {},
	): Pipe2D<boolean> {
		const maxDistance = options.maxDistance ?? Infinity;
		const boundariesVisible = options.boundariesVisible ?? true;
		return new Pipe2D<boolean>(
			this.gridView.width,
			this.gridView.height,
			(x, y) => {
				if (!isClear(this)) {
					return x === this.x && y === this.y ? boundariesVisible : false;
				}

				if (maxDistance < Infinity) {
					if (getDistance(this, { x, y }) > maxDistance) {
						return false;
					}
				}
				
				for (const cell of this.getLineTo({ x, y })) {
					if (isClear(cell)) continue;
					return cell.x === x && cell.y === y
						? boundariesVisible
						: false;
				}
				
				return true;
			}
		);
	}


}

function getDistance(c1: {x: number, y: number}, c2: {x: number, y: number}): number {
    return Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));
}

export class Grid<T> {

	/**
	 * A `Pipe2D` of this grid's Cells, providing location-based functionality
	 * 
	 * @see https://github.com/tiadrop/pipe2d
	 */
	readonly cells = new Pipe2D(this.width, this.height, (x, y) => {
		return new Cell(x, y, this)
	}).strict().withCache();

	protected constructor(
		public readonly width: number,
		public readonly height: number,
		private parentGet: GetXYFunc<T>,
		private parentSet: (x: number, y: number, value: T) => void,
		private batch: (cb: () => void) => void,
	) {}

	/**
	 * A `Pipe2D` of this grid's values.
	 * 
	 * `Pipe2D` is a lazily-evaluated 2D pipeline. Values produced by the pipeline reflect the grid's state when the pipeline is queried.
	 */
	pipe = new Pipe2D(this);

	/**
	 * Executes a custom callback without triggering any `change` events on the underlying GridBase until the callback concludes
	 * @param fn Callback to run while change events are suppressed
	 */
	batchUpdate(fn: () => void) {
		this.batch(fn);
	}

	/**
	 * Retrieves the value at the specified coordinates.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @returns Value read from this grid position
	 */
	get(x: number, y: number) {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
			throw new RangeError("Coordinates out of bounds");
		}
		return this.parentGet(x, y);
	}

	/**
	 * Sets a value at the specified coordinates.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param value Value to store
	 */
	set(x: number, y: number, value: T) {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
			throw new RangeError("Coordinates out of bounds");
		}
		this.parentSet(x, y, value);
	}

	/**
	 * Sets a value at the specified coordinates if they are within the grid's dimensions.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param value Value to store
	 * @returns `true` if the write was successful (in-bounds), otherwise `false`.
	 */
	trySet(x: number, y: number, value: T): boolean {
    	if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    	this.set(x, y, value);
    	return true;
	}

	/**
	 * Sets every cell's value.
	 * @param value Value to store
	 * @param mask Optional 2D boolean source (Grid, Pipe2D, etc) to specify which cells should be modified. Only cells at locations (relative to the target grid) where the mask provides `true` will be changed.
	 */
	fill(value: T, mask?: Source2D<boolean> | GetXYFunc<boolean>) {
		const maskSource = typeof mask == "function" ? {
			width: this.width,
			height: this.height,
			get: mask
		} : mask;
		this.batchUpdate(() => {
			for (let y = 0; y < this.height; y++) {
				for (let x = 0; x < this.width; x++) {
					if (maskSource && !maskSource.get(x, y)) continue;
					this.trySet(x, y, value);
				}
			}
		});
	}

	/**
	 * Copies values from a 2D source (Grid, Pipe2D, etc) to this Grid.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param source Source to copy values from
	 * @param mask Optional 2D boolean source (Grid, Pipe2D, etc) to specify which cells should be modified. Only cells at locations (relative to the target grid) where the mask provides `true` will be changed.
	 */
	paste(x: number, y: number, source: Source2D<T>, mask?: Source2D<boolean> | GetXYFunc<boolean>) {
		const maskSource = typeof mask == "function" ? {
			width: this.width,
			height: this.height,
			get: mask
		} : mask;
		const cachedSource = new GridBase(source);
		this.batchUpdate(() => {
			for (let oy = 0; oy < source.height; oy++) {
				for (let ox = 0; ox < source.width; ox++) {
					const tx = ox + x;
					const ty = oy + y;
					if (maskSource && !maskSource.get(tx, ty)) continue;
					this.trySet(tx, ty, cachedSource.get(ox, oy));
				}
			}
		});
	}

	*[Symbol.iterator](): IterableIterator<{x: number, y: number, value: T}> {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				yield {x, y, value: this.get(x, y)};
			}
		}
	}

	/**
	 * Perform a callback on every value in this Grid
	 * @param callback Callback to run for every cell's value
	 */
	forEach(callback: (value: T, x: number, y: number) => void): void {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				callback(this.get(x, y), x, y);
			}
		}
	}

	combine<U, R>(aux: Source2D<U>, cb: (source: T, aux: U) => R) {
		const width = Math.min(this.width, aux.width);
		const height = Math.min(this.height, aux.height);
		return new GridBase({
			width,
			height,
			get: (x, y) => {
				return cb(this.get(x, y), aux.get(x, y))
			}
		});
	}

	/**
	 * Creates a *two-way* transformed view of this Grid.
	 * 
	 * Changes to this grid will be reflected in the resulting view, and vice-versa.
	 * 
	 * For a read-only, lazily evaluated view of this Grid, see {@link pipe | `grid.pipe`}.
	 * @param read Function to transform values from the parent grid
	 * @param write Function to transform values back to the parent grid
	 * @returns A new Grid that provides a transformed view of this grid
	 */
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

	/**
	 * Creates a regional view of this Grid.
	 * 
	 * Changes to this grid will be reflected in the resulting view, and vice-versa, as well as any overlapping regions of the same parent.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param width Region width
	 * @param height Region height
	 * @returns Regional view of this Grid.
	 */
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

	/**
	 * Creates a {@link GridBase | `GridBase`}, initialising every value by means of custom function.
	 * @param width Width of the new Grid
	 * @param height Height of the new Grid
	 * @param initCell Callback to initialise cells
	 * @returns A new GridBase of the specified dimensions.
	 */
	static init<T>(width: number, height: number, initCell: (x: number, y: number) => T) {
		return new GridBase({
			width,
			height,
			get: initCell
		});
	}

	/**
	 * Creates a {@link GridBase | `GridBase`}, using the dimensions of and initialising every value from a 2D source (Grid, Pipe2D, etc).
	 * @param source A 2D source to provide dimensions and initial values
	 * @returns A new GridBase, initialised with values read from `source`.
	 */
	static from<T>(source: Source2D<T>) {
		return new GridBase(source);
	}

	/**
	 * Creates a {@link GridBase | `GridBase`} with every cell initialised to a specified value.
	 * @param width Width of the new Grid
	 * @param height Height of the new Grid
	 * @param fillValue Value to initialise every cell with
	 * @returns A new GridBase of the specified dimensions.
	 */
	static solid<T>(width: number, height: number, fillValue: T) {
		return new GridBase(Pipe2D.solid(fillValue, width, height));
	}
}

/**
 * A storage and control Grid layer.
 * 
 * Unlike {@link Grid}, which acts as an interface for manipulating a region or two-way transformation of a parent Grid, `GridBase` maintains the underlying data.
 */
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

	constructor(source: Source2D<T>) {
		super(
			source.width,
			source.height,
			(x, y) => this.data[this.xyToIndex(x, y)],
			(x, y, value) => this._set(x, y, value),
			fn => this.batchUpdate(fn),
		);

		const sourcePipe = source instanceof Pipe2D
			? source
			: new Pipe2D(source)
			
		this.data = sourcePipe.toFlatArrayXY();
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
