# `Grid`

**Alpha**: Some API details may change

## Summary

A mutable 2D grid with efficient region views, spatial operations, and seamless interoperability with [Pipe2D](https://github.com/tiadrop/pipe2d). Store, edit, and transform 2D data with an ergonomic API designed for practical use.

## Features

- **Mutable 2D storage** with type safety
- **Zero-copy region views** - edit or provide subgrids and transformation layers without copying
- **Spatial operations** - fill, paste, flood fill, pathfinding
- **Pipe2D integration** - materialise pipes, get pipe views
- **Consistent API** - for grids and regions
- **Mask support** - apply operations to arbitrary shapes

## Example

```
npm i @xtia/grid
```

```ts
import { Grid } from "@xtia/grid"; // ~5.3kb gzipped

// initialise a 30x20 Grid<number> of 0's
const numGrid = Grid.solid(30, 20, 0);

// change a value
numGrid.set(3, 3, 50);

// initialise a chessboard
const chessGrid = Grid.init(8, 8, (x, y) => 
  (x + y) % 2 === 0 ? 'black' : 'white'
);

// read a value
const colour = chessGrid.get(4, 5);

// initialise a grid from a Pipe2D
const source = imagePipe
	.crop(10, 10, 64, 64)
	.scale(.5)
	.rotateLeft();
const grid = Grid.from(source);
```

## Regions

Use `grid.region(x, y, w, h)` to define a subgrid. The subgrid is **zero-copy view** into the parent; changes to the subgrid affect the parent and vice-versa.

```ts
// game map with terrain
const world = Grid.solid(100, 100, "grass"); // Grid<string>

// add a lake
world.region(30, 30, 20, 20).fill("water");

// add mountains around the lake with a circular mask
const centre = world.cells.get(40, 40);
const mask = (x: number, y: number) => {
  const dist = Math.hypot(x - centre.x, y - centre.y);
  return dist > 12 && dist < 18; // mountain ring
};
world.fill("mountain", mask);

// get a view of just the interesting area
const lakeRegion = world.region(25, 25, 30, 30);

// do we want a distinct, self-contained copy of the region?
const lakeGrid = Grid.from(lakeRegion);
```

## Transformation Layers

`grid.map(read, write)` creates a **view** that reads and writes the parent through the provided transformation functions.

```ts
const spriteMap = world.map(
	type => type + ".png",
	sprite => sprite.replace(/\.*/, '')
);

world.set(0, 0, "mountain"); // modify the parent
console.log(spriteMap.get(0, 0)); // read the transformed view: "mountain.png"
spriteMap.set(1, 0, "forest.png"); // modify the view
console.log(world.get(1, 0)); // read the parent: "forest"
```

For one-way read-mapping, use `grid.pipe` - a [Pipe2D](https://github.com/tiadrop/pipe2d) view into the grid's data.

```ts
// create a one-way, player-centred sprite map
const viewport = world.pipe
	.oob("mountain")
	.map(t => t + ".png")
	.crop(playerX - 5, playerY - 5, 10, 10);

// or get a list of locations of cells with mountains
const mountainCells = world.cells.toFlatArrayXY()
	.filter(cell => cell.value === "mountain")
	.map(cell => [cell.x, cell.y]);

```

## Cell interface

`grid.cells` provides a Pipe2D, for convenient transformation, of live-view interfaces relating to positions in the grid.

```ts
const topLeft = world.cells.get(0, 0);
console.log(topLeft.value); // "mountain"

topLeft.value = "forest"; // modifies the underlying data
console.log(spriteMap.get(0, 0)); // now "forest.png";

// navigate by offset
const adjacentCell = topLeft.look(1, 0);
console.log(adjacentCell.x, adjacentCell.y); // 1, 0
```

Cells provide methods for locational utilities such as pathfinding and visibility mapping.

Cells are unique to, owned by, and coordinated relative to the view that provided them. Their pathfinding and visibility mapping features are unaware of space outside of their view's bounds.

### (Everybody needs good) Neighbours

`cell.getNeighbours(includeDiagonals?)` returns an array of Cells:

```ts
// derive a display number for clicked cells in Minesweeper
const numOfAdjacentMines = clickedCell.getNeighbours(true)
	.filter(cell => cell.value.isMine)
	.length;
```

### Path finding
```ts
const costs = {
	grass: 1,
	water: Infinity,
	mountain: Infinity,
	forest: 2
};

const start = world.cells.get(5, 5);
const destination = world.cells.get(90, 90);
const path = start.findPath(
	destination, // or simply [90, 90]
	(cell) => costs[cell.value]
); // Cell<string>[]
```

### Visibility mapping

```ts
// createVisibilityMap(isClear);
const visibility = start.createVisibilityMap(
	cell => cell.value === "grass" // anything except grass blocks vision
);

// any 2d source, including visibility maps, can be used as a mask for paste/fill operations
// paste(source: Source2D<T>, mask?: Source2D<boolean>)
screenGrid.paste(spriteMap, visibility);
```

### Reusing path data

Use `cell.getPathMap(costFunc)` to create a Pipe2D of optimal paths from the parent cell. The grid space is explored once to produce an internal traversal map, and paths to individual cells are constructed from that data (and cached) when that pipe is queried.

```ts
const pathMap = start.getPathMap(c => costs[c.value]);

const pathToCentre = pathMap.get(50, 50);
const pathToCorner = pathMap.get(99, 99);
```

Unlike visibility maps, which are lazily evaluated according to the supplied `isWall` function *when the map is queried*, path maps necessarily reflect the underlying data *when the map is created*. This distinction is hinted through the `create*` vs `get*` naming.

## The storage layer

`Grid` itself is an interface for reading and writing 2D data. `GridBase` - a subclass of `Grid` - maintains the actual storage of such data.

Although the Grid factory methods (`Grid.solid()`, `Grid.from()`, `Grid.init()`) return a `GridBase<T>`, the mental model is that we're simply working with `Grid`s, therefore those factory methods live on `Grid`. The only API distinction is that `GridBase` provides a 'change' event, via `grid.on("change", handler)`.

You can perform batched updates, holding off the 'change' event until the batch process concludes, with `grid.batchUpdate(callback)`.