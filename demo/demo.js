'use strict';

let Module = {};

let utfDecoder = new TextDecoder('utf-8');
function getStr(ptr, len) {
    let slice = new Uint8Array(Module.memory.buffer, ptr, len);
    return utfDecoder.decode(slice);
};

var actx = new AudioContext();
var audio_next = 0;
var turbo = false;
var realCanvas = null;

function fetch_with_cors_if_needed(url, callback, error) {
    let on_ok = resp => {
        if (resp.ok)
            resp.arrayBuffer().then(callback);
        else
            error();
    };
    fetch(url).
        then(on_ok).
        catch(_ => {
            fetch('https://cors-anywhere.herokuapp.com/' + url).
                then(on_ok).
                catch (e => {
                    error(e);
                });
        });
}


var g_delayed_funcs = null;
function call_with_delay(first, other, args) {
    g_delayed_funcs = [first, other, args];
}

var g_lastSnapshot = null;

function onDocumentLoad() {

    let urlParams = new URLSearchParams(window.location.search);
    let webgl = urlParams.get('webgl');
    webgl = webgl === null || webgl != "false";

    let ctx = null, gl = null;

    let canvas3d = document.getElementById('game-layer-3d');
    let canvas = document.getElementById('game-layer');

    if (webgl) {
        gl = canvas3d.getContext('webgl');
    }

    if (gl && initMyGL(gl)) {
        console.log("using webgl rendering");
        realCanvas = canvas3d;
    } else {
        if (webgl)
            console.log("webgl initialization failed, falling back to canvas");
        else
            console.log("webgl initialization skipped, falling back to canvas");
        gl = null;
        canvas3d.style.display = 'none';
        canvas.style.display = '';

        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        realCanvas = canvas;
    }

    let imports = {
        env: {
            consolelog: (ptr, len) => console.log(getStr(ptr, len)),
            alert: (ptr, len) => alert(getStr(ptr, len)),
            putImageData: (w, h, ptr, len) => {
                if (gl) {
                    let data = new Uint8Array(Module.memory.buffer, ptr, len);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                    gl.flush();
                } else {
                    let data = new Uint8ClampedArray(Module.memory.buffer, ptr, len);
                    let img = new ImageData(data, w, h);
                    ctx.putImageData(img, 0, 0);
                }
            },
            putSoundData: (ptr, len) => {
                let asrc = actx.createBufferSource();
                let abuf = actx.createBuffer(1, len, Module.is128k? 21112 : 20833); // cpufreq / AUDIO_SAMPLE / RATE_MULTIPLIER
                let data = abuf.getChannelData(0);
                let slice = new Float32Array(Module.memory.buffer, ptr, len);
                for (let i = 0; i < len; ++i)
                    data[i] = slice[i];
                asrc.buffer = abuf;
                asrc.connect(actx.destination);

                asrc.start(audio_next);
                audio_next = Math.max(audio_next, actx.currentTime) + abuf.duration;
            },
            onTapeBlock: (index) => {
                onTapeBlock(index);
            },
        }
    };
    let wasm = '/target/wasm32-unknown-unknown/release/raze.wasm';
    if (WebAssembly.instantiateStreaming) {
        wasm = WebAssembly.instantiateStreaming(fetch(wasm), imports);
    } else {
        wasm = fetch(wasm).
                then(resp => resp.arrayBuffer()).
                then(bytes => WebAssembly.instantiate(bytes, imports));
    }
    wasm.
        then(wasm => {
            let exports = wasm.instance.exports;
            Object.assign(Module, {
                wasm: wasm,
                exports: exports,
                memory: exports.memory,
            });
            var url = new URL(window.location.href);

            var is128k = url.searchParams.get("48k") === null;
            Module.is128k = is128k;
            Module.game = exports.wasm_main(is128k);

            var snapshot = url.searchParams.get("snapshot");
            console.log("SNAPSHOT=", snapshot);
            if (snapshot) {
                fetch_with_cors_if_needed(snapshot,
                    bytes => {
                        g_lastSnapshot = bytes;
                        handleLoadLastSnapshot();
                    },
                    error => {
                        alert("Cannot download file " + snapshot);
                    }
                );
            }

            var tape = url.searchParams.get("tape");
            console.log("TAPE=", tape);
            if (tape) {
                fetch_with_cors_if_needed(tape,
                    bytes => {
                        if (bytes) {
                            if (is128k) {
                                call_with_delay(1000, 100, [
                                    () => Module.exports.wasm_key_down(Module.game, 0x60), //ENTER
                                    () => Module.exports.wasm_key_up(Module.game, 0x60), //ENTER
                                    () => onLoadTape(bytes),
                                ]);
                            } else {
                                call_with_delay(2000, 100, [
                                    () => Module.exports.wasm_key_down(Module.game, 0x63), //J (LOAD)
                                    () => Module.exports.wasm_key_up(Module.game, 0x63),
                                    () => Module.exports.wasm_key_down(Module.game, 0x71), //SS
                                    () => Module.exports.wasm_key_down(Module.game, 0x50), //P (")
                                    () => Module.exports.wasm_key_up(Module.game, 0x50), //P (")
                                    () => Module.exports.wasm_key_down(Module.game, 0x50), //P (")
                                    () => Module.exports.wasm_key_up(Module.game, 0x50), //P (")
                                    () => Module.exports.wasm_key_up(Module.game, 0x71), //SS
                                    () => Module.exports.wasm_key_down(Module.game, 0x60), //ENTER
                                    () => Module.exports.wasm_key_up(Module.game, 0x60), //ENTER
                                    () => onLoadTape(bytes),
                                ]);
                            }
                        }
                    },
                    error => {
                        alert("Cannot download file " + tape);
                    }
                );
            }
            window.addEventListener('keydown', onKeyDown)
            window.addEventListener('keyup', onKeyUp)
            window.addEventListener('focus', onFocus)
            window.addEventListener('blur', onBlur)
            audio_next = actx.currentTime;
            if (document.hasFocus())
                onFocus();
        });

    document.getElementById('reset_48k').addEventListener('click', handleReset48k, false);
    document.getElementById('reset_128k').addEventListener('click', handleReset128k, false);
    document.getElementById('load_tape').addEventListener('click', handleLoadTape, false);
    document.getElementById('stop_tape').addEventListener('click', handleStopTape, false);
    document.getElementById('snapshot').addEventListener('click', handleSnapshot, false);
    document.getElementById('load_snapshot').addEventListener('click', handleLoadSnapshot, false);
    document.getElementById('load_last_snapshot').addEventListener('click', handleLoadLastSnapshot, false);
    document.getElementById('fullscreen').addEventListener('click', handleFullscreen, false);
    document.getElementById('turbo').addEventListener('click', handleTurbo, false);
    document.getElementById('dither').addEventListener('click', function(evt) { handleDither.call(this, evt, gl) }, false);
    document.getElementById('cursor_keys').addEventListener('change', handleCursorKeys, false);
    handleCursorKeys.call(document.getElementById('cursor_keys'));
}

function onKeyDown(ev) {
    //console.log(ev.code);
    switch (ev.code) {
    case "F6":
        handleSnapshot(ev);
        ev.preventDefault();
        return;
    case "F9":
        handleLoadLastSnapshot(ev);
        ev.preventDefault(ev);
        return;
    case "F11":
        handleFullscreen(ev);
        ev.preventDefault(ev);
        return;
    }

    let key = getKeyCode(ev);
    if (key == undefined)
        return;
    Module.exports.wasm_key_down(Module.game, key);
    ev.preventDefault();
}
function onKeyUp(ev) {
    let key = getKeyCode(ev);
    if (key == undefined)
        return;
    Module.exports.wasm_key_up(Module.game, key);
    ev.preventDefault();
}

var interval = null;
function onFocus(ev) {
    if (!g_delayed_funcs)
        Module.exports.wasm_reset_input(Module.game);
    if (interval === null) {
        interval = setInterval(function(){
            if (turbo) {
                Module.exports.wasm_draw_frame(Module.game, true);
            } else while (audio_next - actx.currentTime < 0.05) {
                Module.exports.wasm_draw_frame(Module.game, false);
                if (g_delayed_funcs !== null) {
                    if ((g_delayed_funcs[0] -= 20) <= 0) {
                        var f = g_delayed_funcs[2].shift();
                        if (f) {
                            f();
                            g_delayed_funcs[0] = g_delayed_funcs[1];
                        } else {
                            g_delayed_funcs = null;
                        }
                    }
                }
            }
        }, 0);
    }
}
function onBlur(ev) {
    if (!g_delayed_funcs)
        Module.exports.wasm_reset_input(Module.game);
    if (interval !== null) {
        clearInterval(interval);
        interval = null;
    }
}

var cursorKeys = null;

function handleCursorKeys(evt) {
    var sel;
    switch (this.value) {
        default:
        case "cursorkeys":
            sel = 0;
            break;
        case "kempston":
            sel = 1;
            break;
        case "sinclair":
            sel = 2;
            break;
        case "cursorjoy":
            sel = 3;
            break;
    }
    cursorKeys = CURSOR_KEYS[sel];
    this.blur();
}

const CURSOR_KEYS = [
    //cursorkeys
    [0xf034, 0xf042, 0xf044, 0xf043, 0x71], //Shift+{5,8,6,7}, SymbolShift
    //kempston
    [0x81, 0x80, 0x82, 0x83, 0x84],
    //sinclair
    [0x44, 0x43, 0x42, 0x41, 0x40], //6, 7, 8, 9, 0
    //cursorjoy
    [0x34, 0x42, 0x44, 0x43, 0x40], //5, 8, 6, 7, 0
];

function getKeyCode(ev) {
    switch (ev.code) {
    case "ArrowLeft":
        return cursorKeys[0];
    case "ArrowRight":
        return cursorKeys[1];
    case "ArrowDown":
        return cursorKeys[2];
    case "ArrowUp":
        return cursorKeys[3];
    case "ControlLeft":
        return cursorKeys[4];

    case "ShiftLeft":
    case "ShiftRight":
        return 0xf0; //just like 0x00, but 0x00 is ignored by game code
    case "KeyZ":
        return 0x01;
    case "KeyX":
        return 0x02;
    case "KeyC":
        return 0x03;
    case "KeyV":
        return 0x04;
    case "KeyA":
        return 0x10;
    case "KeyS":
        return 0x11;
    case "KeyD":
        return 0x12;
    case "KeyF":
        return 0x13;
    case "KeyG":
        return 0x14;
    case "KeyQ":
        return 0x20;
    case "KeyW":
        return 0x21;
    case "KeyE":
        return 0x22;
    case "KeyR":
        return 0x23;
    case "KeyT":
        return 0x24;
    case "Digit1":
        return 0x30;
    case "Digit2":
        return 0x31;
    case "Digit3":
        return 0x32;
    case "Digit4":
        return 0x33;
    case "Digit5":
        return 0x34;
    case "Digit0":
        return 0x40;
    case "Digit9":
        return 0x41;
    case "Digit8":
        return 0x42;
    case "Digit7":
        return 0x43;
    case "Digit6":
        return 0x44;
    case "KeyP":
        return 0x50;
    case "KeyO":
        return 0x51;
    case "KeyI":
        return 0x52;
    case "KeyU":
        return 0x53;
    case "KeyY":
        return 0x54;
    case "Enter":
        return 0x60;
    case "KeyL":
        return 0x61;
    case "KeyK":
        return 0x62;
    case "KeyJ":
        return 0x63;
    case "KeyH":
        return 0x64;
    case "Space":
        return 0x70;
    case "ControlRight":
        return 0x71;
    case "KeyM":
        return 0x72;
    case "KeyN":
        return 0x73;
    case "KeyB":
        return 0x74;
    case "Backspace":
        return 0xf040; //Shift+0
    default:
        return null;
    }
}

function resetTape() {
    var xTape = document.getElementById("tape");
    while (xTape.firstChild)
        xTape.removeChild(xTape.firstChild);
    return xTape;
}

function onTapeBlock(index) {
    console.log("Block", index);
    var xTape = document.getElementById("tape");
    for (var i = 0; i < xTape.children.length; ++i) {
        var btn = xTape.children[i];
        if (btn['data-index'] == index)
            btn.classList.add('selected');
        else
            btn.classList.remove('selected');
    }
}

function onLoadTape(data) {
    console.log("data " + data.byteLength);
    console.log(data);
    var ptr = Module.exports.wasm_alloc(data.byteLength);
    var d = new Uint8Array(Module.memory.buffer, ptr, data.byteLength);
    d.set(new Uint8Array(data));
    let tape_len = Module.exports.wasm_load_tape(Module.game, ptr, data.byteLength);
    var xTape = resetTape();

    for (let i = 0; i < tape_len; ++i) {
        let tape_ptr = Module.exports.wasm_tape_name(Module.game, i);
        let tape_ptr_len = Module.exports.wasm_tape_name_len(Module.game, i);
        let selectable = Module.exports.wasm_tape_selectable(Module.game, i);
        let tape_name = getStr(tape_ptr, tape_ptr_len);
        console.log("Tape ", i, tape_name);
        if (selectable) {
            let btn = document.createElement("button");
            btn.textContent = tape_name;
            xTape.appendChild(btn);
            btn.addEventListener('click', handleTapeBlock, false);
            btn['data-index'] = i;
        }
    }
    xTape.firstChild.classList.add('selected');
}

function handleTapeSelect(evt) {
    var f = evt.target.files[0];
    console.log("reading " + f.name);
    var reader = new FileReader();
    reader.onload = function(e) { onLoadTape(this.result); };
    reader.readAsArrayBuffer(f);
}

function handleTapeBlock(evt) {
    var btn = evt.target;
    var index = btn['data-index'];
    //evt.target.classList.add('playing');
    Module.exports.wasm_tape_seek(Module.game, index);
}

function handleReset48k(evt) {
    resetTape();
    Module.exports.wasm_drop(Module.game);
    Module.is128k = false;
    Module.game = Module.exports.wasm_main(Module.is128k);
}

function handleReset128k(evt) {
    resetTape();
    Module.exports.wasm_drop(Module.game);
    Module.is128k = true;
    Module.game = Module.exports.wasm_main(Module.is128k);
}

function handleLoadTape(evt) {
    var x = document.createElement("input");
    x.type = "file";
    x.accept = [".tap", ".tzx", ".zip"];
    x.addEventListener('change', handleTapeSelect, false);
    x.click();
}

function handleStopTape(evt) {
    Module.exports.wasm_tape_stop(Module.game);
}

function handleLoadSnapshotSelect(evt) {
    var f = evt.target.files[0];
    console.log("reading " + f.name);
    var reader = new FileReader();
    reader.onload = function(e) {
        g_lastSnapshot = this.result;
        var ptr = Module.exports.wasm_alloc(g_lastSnapshot.byteLength);
        var d = new Uint8Array(Module.memory.buffer, ptr, g_lastSnapshot.byteLength);
        d.set(new Uint8Array(g_lastSnapshot));
        Module.is128k = Module.exports.wasm_load_snapshot(Module.game, ptr, g_lastSnapshot.byteLength);
    }
    reader.readAsArrayBuffer(f);
}

function handleLoadSnapshot(evt) {
    var x = document.createElement("input");
    x.type = "file";
    x.accept = [".z80", ".zip"];
    x.addEventListener('change', handleLoadSnapshotSelect, false);
    x.click();
}

function handleLoadLastSnapshot(evt) {
    if (!g_lastSnapshot)
        return;

    var ptr = Module.exports.wasm_alloc(g_lastSnapshot.byteLength);
    var d = new Uint8Array(Module.memory.buffer, ptr, g_lastSnapshot.byteLength);
    d.set(new Uint8Array(g_lastSnapshot));
    Module.is128k = Module.exports.wasm_load_snapshot(Module.game, ptr, g_lastSnapshot.byteLength);
}

function handleSnapshot(evt) {
    console.log("snapshot");
    let snapshot = Module.exports.wasm_snapshot(Module.game);
    let ptr = Module.exports.wasm_buffer_ptr(snapshot);
    let len = Module.exports.wasm_buffer_len(snapshot);
    var data = new Uint8Array(Module.memory.buffer, ptr, len);
    var blob = new Blob([data], {type: "application/octet-stream"});
    var url = window.URL.createObjectURL(blob);

    g_lastSnapshot = new Uint8Array(len);
    g_lastSnapshot.set(data);

    var a = document.createElement("a");
    a.style = "display: none";
    a.href = url;
    a.download = "snapshot.z80";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    Module.exports.wasm_buffer_free(snapshot);
}
function handleFullscreen(evt) {
    console.log("fullscreen");
    var canvas = realCanvas;
    var fs = canvas.requestFullscreen || canvas.mozRequestFullScreen || canvas.webkitRequestFullScreen || canvas.msRequestFullscreen;
    if (fs)
        fs.call(canvas);
}

function handleTurbo(evt) {
    turbo = this.checked;
}

function handleDither(evt, gl) {
    if (!gl)
        return;

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.checked? gl.LINEAR : gl.NEAREST);
}

document.addEventListener("DOMContentLoaded", onDocumentLoad);

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.log('Shader compiler error: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}
function linkShader(gl, vs, fs) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vs);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fs);
    if (!vertexShader || !fragmentShader) {
        return null;
    }

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.log('Shader linker error: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }
    return shaderProgram;
}

function initMyGL(gl) {
    if (!gl) {
        return false;
    }
    //Shaders
    const vs = `
    attribute vec2 aPos;
    attribute vec2 aTex;
    varying highp vec2 vTex;

    void main() {
      gl_Position = vec4(aPos, 0, 1);
      vTex = aTex;
    }
    `;

    const fs = `
    uniform sampler2D uSampler;
    varying highp vec2 vTex;

    void main() {
        gl_FragColor = texture2D(uSampler, vTex);
    }
    `;
    const program = linkShader(gl, vs, fs);
    if (!program)
        return false;

    //Buffers
    const bufferV = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufferV);

    const positionsV = [
        1.0,  1.0,
        -1.0,  1.0,
        1.0, -1.0,
        -1.0, -1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array(positionsV),
        gl.STATIC_DRAW);

    const bufferT = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufferT);

    const positionsT = [
        1.0,  0.0,
        0.0,  0.0,
        1.0,  1.0,
        0.0,  1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array(positionsT),
        gl.STATIC_DRAW);
    
    //let buffers = { vertex: bufferV, texture: bufferT };

    gl.clearColor(0.0,0.0,0.0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufferV);
    let aPos = gl.getAttribLocation(program, 'aPos');
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPos);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufferT);
    let aTex = gl.getAttribLocation(program, 'aTex');
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aTex);
    
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const pixel = new Uint8Array([255, 0, 255, 255]); //dummy image
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    let uSampler = gl.getUniformLocation(program, 'uSampler');
    gl.uniform1i(uSampler, 0);
    const error = gl.getError();
    if (error != 0) {
        console.log("GL error: ", error);
        return false;
    }
    return true;
}
