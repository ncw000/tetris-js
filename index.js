/****
 *  Nathan Weir, nathan.weir@protonmail.com
 */

///// UI elements & render data
// Canvas and context objects for rendering in Draw()
var _canvas = document.getElementById('gameCanvas');
var _ctx = _canvas.getContext('2d');

// The # of Rows and columns of the Tetris board
var _boardWidth = 10;
var _boardHeight = 22;

// The pixel width and height of the 'squares' comprising the Tetris game board
var _squareWidth = Math.floor(_canvas.clientWidth/_boardWidth);
// Note the -2; the top two rows are not visible on the screen
var _squareHeight = Math.floor(_canvas.clientHeight/(_boardHeight-2));

// Is the game currently running? Is set to false when the player loses
var _gameInPlay = true;
// Is the game paused? Is set to true when the player presses 'p'
var _gamePaused = false;

// How often the game should process the next logic loop, in milliseconds
var _gameSpeed = 100;

///// Data structures used to store/calculate game state

// Blocks currently visible on the board.
// A block is {x: 0, y: 0, color: 'green'}, etc

// The squares previously placed on the board.
// These are the indiviudal squares (segments of a Tetris piece) 
// that are not player controlled. These are objects of the form
// { x: 0, y: 1, color: 'red' } etc denoting square location and
// draw color
var _placedSquares = [];

// And array of squares that are currently falling due to gravity.
// Note that for movement checking purposes these do *not* include the squares
// the comprise the player-controlled active block
// TODO: I believe squares existing in both _fallingSquares and _placedSquares
// may be leading to a visual glitch upon row clear. Investigate
var _fallingSquares = [];

// A list of integers, one for each row, that are bitwise representation of 
// which squares a present and 'fixed' (re: not moving) in a row. Used for quick
// collision checks.
// For instance, _fixedBlocks[2] = 5 (101 in binary) means that row 2 (zero indexed) has blocks
// fixed at columns 2 and 0 (zero indexed)
var _collisionRows = [];

// The value corresponding to a full row per _collisionRows above.
var _fullRowVal = Math.pow(2, _boardWidth)-1;

// The Tetris piece currently under the player's control, and falling on the board
// Has the form: {
//    x: 0,
//    y: 1,
//    m: [ [..], [..], .. ]   
// }
// Where x and y mark the position of the top-left of this piece on the board, and m is a matrix
// of row/column offsets paired with colors that represents the 'squares' comprising this piece. See
// SpawnNewPiece() for more info
var _activePiece = [];

// Whether or not a Tetris piece is currently falling. Used to trigger
// spawning a new piece.
// Note: This is a relic of an older design. We could likely just check to see if _activePiece != []
var _pieceInPlay = false;

/* Initialize the game state and kick off the game logic loop. */
function StartGame() {
    // Initialize the collision rows
    for (var i = 0; i < _boardHeight; i++) {
        _collisionRows.push(0);
    }

    // Use setInterval to process the core game loop at the game's speed.
    let intervalId = setInterval(() => {
        // Handle the game over state when the game is over, and use clearInterval to
        // stop endlessly cycling through the logic loop
        if (!_gameInPlay) {
            DrawGameOver();
            clearInterval(intervalId);
        }

        GameLoop();
    }, _gameSpeed);
}

/* The core logic and rendering loop for this game. Handles all regularly timed logic updates.
 * The notable omission is game updates caused by player input (keyboard presses), which occurrs outside of
 * the loop in HandleKeyInput() */
function GameLoop() {
    // Do nothing when the game is paused.
    // Unfortunately this is potentially quite wasteful and inefficient. There exist ways to mimic a process sleep
    // in JavaScript that may be more reasonable. See http://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
    if (_gamePaused) {
        return;
    }

    // If no player-controlled Tetris piece exists, then spawn a new one
    if (!_pieceInPlay) {
        if (!SpawnNewPiece()) {
            // A piece failed to spawn because it would have overlapped with a fixed square.
            // Game over!
            SetGameOver();
            return;
        }
    }

    // Redraw the Tetris board, blocks, and player piece
    Draw();

    // Handle blocks and the player piece falling due to gravity
    ProcessGravity();

    // Check to see if any rows need to be cleared.
    // TODO: It is inefficient and excessive to call this on every GameLoop call. We could do better by only checking for rows to clear
    // when we mark squares as 'fixed' after a player's piece stops moving and is settles at the bottom.
    CheckForRowsCleared();
}

function SetGameOver() {
    _gameInPlay = false;
}

/* Create a new player controlled Tetris peice */
function SpawnNewPiece() {
    // Create a new randomly selected piece. Format of 'piece' is the same as _activePiece
    let piece = GenerateNewPiece();

    // Offset the piece to the middle of the board
    piece.x += Math.round(_boardWidth/2)-2;

    // Check if a piece already exists in the spawn position.
    // If so, return 'false' to signal failing to spawn a new piece.
    // This causes the player to lose the game
    for (var i = 0; i < piece.m.length; i++) {
        for (var j = 0; j < piece.m[i].length; j++) {
            let square = piece.m[i][j];

            // Note this check for falsiness on square: This is used throughout the game logic
            // to see if we're looking at a square for this piece, or one of the 'false' values
            // that exists in the piece matrix to denote the empty spaces around the current piece
            if (!square) { continue; }

            // Is there a block already fixed at this location?
            let x = piece.x + j;
            let y = piece.y + i;
            if (SquareFixedAt(x, y)) {
                return false;
            }
        }
    }

    // Set the active piece
    _activePiece = piece;
    _pieceInPlay = true;

    // Signal that a piece was added successfully
    return true;
}

/* Move the player piece and the board squares downwards due to gravity */
function ProcessGravity() {
    // Check to see if we should move the player piece, or if it is blocked by a fixed square.

    let movePlayerPiece = true;
    for (var i = 0; i < _activePiece.m.length; i++) {
        for (var j = 0; j < _activePiece.m[i].length; j++) {
            let b = _activePiece.m[i][j];
            if (!b) { continue; }

            let x = _activePiece.x + j;
            let y = _activePiece.y + i;

            // If we've hit the bottom of the board or there's a square in the way, do not move the piece
            if (y > _boardHeight-2 || SquareFixedAt(x, y+1)) {
                movePlayerPiece = false;
                break;
            }   
        }
    }

    // Move the piece down one step, if appropriate
    if (movePlayerPiece) {
        _activePiece.y++;
    } else {
        // Otherwise, destroy this Tetris piece and turn it into a series of fixed squares on teh board
        _activePiece.m.forEach((row, i) => {
            row.forEach((b, j) => {
                if (!b) { return; }
                let x = _activePiece.x + j;
                let y = _activePiece.y + i; 

                // 'Fix' the square in place to creating a 'square' object with the correct coordinates and color,
                // And add it to _placedSquares. Also update the _collisionRow via FixSquareAt
                FixSquareAt(x, y);
                _placedSquares.push({
                    x: x,
                    y: y,
                    color: b
                });
            });
        });

        _activePiece = null;
        _pieceInPlay = false;
    }

    // Simulate gravity on all non player-controlled squares

    // Holds all of the squares that have yet to collide with another square, and should continue to fall on the next 
    // step of the game logic
    let stillFalling = [];

    _fallingSquares.forEach(b => {
        // Allow squares to fall if they won't run off the board or collide with another square
        if (b.y < _boardHeight-1 && !SquareFixedAt(b.x, b.y+1)) {
            b.y++;
            stillFalling.push(b);
        } else {
            // Otherwise, fix them to the board
            FixSquareAt(b.x, b.y);
        }
    });

    _fallingSquares = stillFalling;
}

function DrawGameOver() {
    console.log('You lose!');
}

/* Draw every square, and the player piece */
function Draw() {
    // Clear the canvas
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    // Draw each square
    _placedSquares.forEach(b => {
        DrawBlock(b);
    });

    // _activePiece can be [] if a piece was just placed, so omit drawing it if so
    if (!_activePiece) {
        return;
    }

    // Construct squares out of all the segments of the current player piece.
    // Note: This is a relic of an older design. We could likely transport ready-made square objects in the _activePiece matrix,
    // given more development time
    _activePiece.m.forEach((row, i) => {
        row.forEach((b, j) => {
            if (!b) { return; }
            let x = _activePiece.x + j;
            let y = _activePiece.y + i;
            DrawBlock({x: x, y: y, color: b});
        });
    });
}

/* Draw a colored square on the canvas */
function DrawBlock(b) {
    _ctx.fillStyle = b.color;
    // Note the -2: blocks in rows 0 and 1 are not visible to the player
    _ctx.fillRect(b.x*_squareWidth, (b.y-2)*_squareHeight, _squareWidth, _squareHeight);
} 

/* Check the board for a full row of squares, and delete any full rows found */
function CheckForRowsCleared() {
    for (var i = 0; i < _boardHeight; i++) {
        // If all the bits for the current row are '1', then remove the row and redraw the board
        if (_collisionRows[i] == _fullRowVal) {
            RemoveRow(i);
            Draw();
        }
    }
}

/* Clear out a full row on the board. */
function RemoveRow(rowIndex) {
    // Reset the bitflags for this row
    _collisionRows[rowIndex] = 0;

    // On row clear, all squares on the board must be made to fall to fill in the vacant space.
    // Add every square on the board to _fallingSquares.
    // Also rebuild the board by only carrying forward to the next game iteration the squares
    // not pressent at the removed row
    let newBoard = [];

    _placedSquares.forEach(b => {
        // Skip squares in the deleted row
        if (b.y == rowIndex) {
            return;
        }

        newBoard.push(b);

        // Unpin this square and add it to the list of squares acted on by gravity
        UnfixSquareAt(b.x, b.y);
        _fallingSquares.push(b);
    });

    _placedSquares = newBoard;
}

/* Set the bitflag for a board coordinate position to mark that this position contains non-moving, fixed square */
function FixSquareAt(x, y) {
    _collisionRows[y] = _collisionRows[y] | (1 << x);
}

/* Check to see if a square at a given position is fixed in place */
function SquareFixedAt(x, y) {
    return _collisionRows[y] & (1 << x);
}

/* Unfix a square at a given coordinate */
function UnfixSquareAt(x, y) {
    _collisionRows[y] = _collisionRows[y] & (1 << x);
}

/* Create a new Tetrix piece to be controlled by the player */
function GenerateNewPiece() {
    // Objects representing the 7 famous Tetris pieces. These consist of a color with which to be drawn,
    // and a matrix that is either 3x3 or 4x4 in size. Illustrated as grids of 0's and 1s for documentation convenience;
    // More efficient representations are possible

    let iPiece = {
        color: 'cyan',
        blocks: [
            [0, 0, 0, 0],
            [1, 1, 1, 1],
            [0, 0, 0, 0],
            [0, 0, 0, 0]
        ]
    };

    let jPiece = {
        color: 'blue',
        blocks: [
            [1, 0, 0],
            [1, 1, 1],
            [0, 0, 0],
        ]
    };

    let lPiece = {
        color: 'orange',
        blocks: [
            [0, 0, 1],
            [1, 1, 1],
            [0, 0, 0],
        ]
    };

    let oPiece = {
        color: 'yellow',
        blocks: [
            [0, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 0],
            [0, 0, 0, 0]
        ]
    };

    let sPiece = {
        color: 'green',
        blocks: [
            [0, 1, 1],
            [1, 1, 0],
            [0, 0, 0],
        ]
    };

    let tPiece = {
        color: 'purple',
        blocks: [
            [0, 1, 0],
            [1, 1, 1],
            [0, 0, 0],
        ]
    };

    let zPiece = {
        color: 'red',
        blocks: [
            [1, 1, 0],
            [0, 1, 1],
            [0, 0, 0],
        ]
    };

    // Select a random piece from the set
    let pieceTypes = [iPiece, jPiece, lPiece, oPiece, sPiece, tPiece, zPiece];
    let randomPiece = pieceTypes[Math.round(Math.random()*(pieceTypes.length-1))];

    // Construct a player piece object of the same format as _activePiece. 0's in the grids above are replaced with
    // 'false', and 1s are replaced with the piece's color
    let matrix = [];
    randomPiece.blocks.forEach((row) => {
        let rowBlocks = [];
        row.forEach((item) => {
            if (item == 0) {
                rowBlocks.push(false);
            }
            else {
                rowBlocks.push(randomPiece.color);
            }
        });

        matrix.push(rowBlocks);
    });

    return { x: 0, y: 0, m: matrix };
}

/* Move a piece left and right on the board. Triggered by player input */
function MovePieceSideways(moveLeft) {
    // If a piece was just removed, exit
    if (!_activePiece) { return; }

    // Determine if we should move this piece by checking for collisions. If a collision on any square is found,
    // then abort attempting to move the piece
    // Collision logic is similar to that used in ProcessGravity()
    let movePiece = true;
    for (var i = 0; i < _activePiece.m.length; i++) {
        for (var j = 0; j < _activePiece.m[i].length; j++) {
            let b = _activePiece.m[i][j];
            if (!b) { continue; }

            let x = _activePiece.x + j;
            let y = _activePiece.y + i;

            if (moveLeft && x == 0 || SquareFixedAt(x-1, y)) {
                movePiece = false;
                return;       
            }
            else if (!moveLeft && x == _boardWidth-1 || SquareFixedAt(x+1, y)) {
                movePiece = false;
                return;
            }
        } 
    }

    if (!movePiece) { return; }

    // Move the piece left or right as appropriate
    _activePiece.x += moveLeft ? -1 : 1;

    Draw();
}

/* Rotate the matrix for a piece to accomplish rotating the piece on the board */
function RotatePiece(m) {
    // Construct a new 3x3 or 4x4 array with the values from the previous one
    if (m.length == 4) {
        return [
            [m[3][0], m[2][0], m[1][0], m[0][0]],
            [m[3][1], m[2][1], m[1][1], m[0][1]],
            [m[3][2], m[2][2], m[1][2], m[0][2]],
            [m[3][3], m[2][3], m[1][3], m[0][3]]
        ];
    } else { // Length is 3, a 3x3 matrix
        return [
            [m[2][0], m[1][0], m[0][0]],
            [m[2][1], m[1][1], m[0][1]],
            [m[2][2], m[1][2], m[0][2]]
        ];
    }
}

/* Handle Tetris piece moves, rotation, and game pausing on keyboard input */
function HandleKeyInput(e) {
    switch (e.key) {
        case 'ArrowLeft':
            MovePieceSideways(true);
            break;
        case 'ArrowUp':
            if (!_activePiece) { return; }
            _activePiece.m = RotatePiece(_activePiece.m);
            Draw();
            break;
        case 'ArrowRight':
            MovePieceSideways(false);
            break;
        case 'p':
            _gamePaused = !_gamePaused;
            break;
    }
}

// Launch the game when the browser is ready.
// Via http://youmightnotneedjquery.com/
document.addEventListener('DOMContentLoaded', StartGame);
// Handle Tetris piece moves, rotation, and game pausing on keyboard input
document.addEventListener('keydown', HandleKeyInput);