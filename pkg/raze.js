import { putImageData, putSoundData, onTapeBlock } from '../raze.js';

let wasm;

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

let cachegetUint8Memory0 = null;
function getUint8Memory0() {
    if (cachegetUint8Memory0 === null || cachegetUint8Memory0.buffer !== wasm.memory.buffer) {
        cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachegetUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

function getArrayU8FromWasm0(ptr, len) {
    return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachegetFloat32Memory0 = null;
function getFloat32Memory0() {
    if (cachegetFloat32Memory0 === null || cachegetFloat32Memory0.buffer !== wasm.memory.buffer) {
        cachegetFloat32Memory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachegetFloat32Memory0;
}

function getArrayF32FromWasm0(ptr, len) {
    return getFloat32Memory0().subarray(ptr / 4, ptr / 4 + len);
}
/**
* @param {boolean} is128k
* @returns {number}
*/
export function wasm_main(is128k) {
    var ret = wasm.wasm_main(is128k);
    return ret;
}

/**
* @param {number} game
*/
export function wasm_drop(game) {
    wasm.wasm_drop(game);
}

/**
* @param {number} size
* @returns {number}
*/
export function wasm_alloc(size) {
    var ret = wasm.wasm_alloc(size);
    return ret;
}

/**
* @param {number} game
* @param {boolean} turbo
*/
export function wasm_draw_frame(game, turbo) {
    wasm.wasm_draw_frame(game, turbo);
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1);
    getUint8Memory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
* @param {number} game
* @param {Uint8Array} data
* @returns {number}
*/
export function wasm_load_tape(game, data) {
    var ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    var ret = wasm.wasm_load_tape(game, ptr0, len0);
    return ret >>> 0;
}

let cachegetInt32Memory0 = null;
function getInt32Memory0() {
    if (cachegetInt32Memory0 === null || cachegetInt32Memory0.buffer !== wasm.memory.buffer) {
        cachegetInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachegetInt32Memory0;
}
/**
* @param {number} game
* @param {number} index
* @returns {string}
*/
export function wasm_tape_name(game, index) {
    try {
        const retptr = wasm.__wbindgen_export_1.value - 16;
        wasm.__wbindgen_export_1.value = retptr;
        wasm.wasm_tape_name(retptr, game, index);
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_export_1.value += 16;
        wasm.__wbindgen_free(r0, r1);
    }
}

/**
* @param {number} game
* @param {number} index
* @returns {boolean}
*/
export function wasm_tape_selectable(game, index) {
    var ret = wasm.wasm_tape_selectable(game, index);
    return ret !== 0;
}

/**
* @param {number} game
* @param {number} index
*/
export function wasm_tape_seek(game, index) {
    wasm.wasm_tape_seek(game, index);
}

/**
* @param {number} game
*/
export function wasm_tape_stop(game) {
    wasm.wasm_tape_stop(game);
}

/**
* @param {number} game
* @param {Uint8Array} data
* @returns {boolean}
*/
export function wasm_load_snapshot(game, data) {
    var ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    var ret = wasm.wasm_load_snapshot(game, ptr0, len0);
    return ret !== 0;
}

/**
* @param {number} game
* @returns {Uint8Array}
*/
export function wasm_snapshot(game) {
    try {
        const retptr = wasm.__wbindgen_export_1.value - 16;
        wasm.__wbindgen_export_1.value = retptr;
        wasm.wasm_snapshot(retptr, game);
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var v0 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 1);
        return v0;
    } finally {
        wasm.__wbindgen_export_1.value += 16;
    }
}

/**
* @param {number} game
*/
export function wasm_reset_input(game) {
    wasm.wasm_reset_input(game);
}

/**
* @param {number} game
* @param {number} key
*/
export function wasm_key_up(game, key) {
    wasm.wasm_key_up(game, key);
}

/**
* @param {number} game
* @param {number} key
*/
export function wasm_key_down(game, key) {
    wasm.wasm_key_down(game, key);
}

/**
* @param {number} game
* @param {number} addr
* @returns {number}
*/
export function wasm_peek(game, addr) {
    var ret = wasm.wasm_peek(game, addr);
    return ret;
}

/**
* @param {number} game
* @param {number} addr
* @param {number} value
*/
export function wasm_poke(game, addr, value) {
    wasm.wasm_poke(game, addr, value);
}

async function load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {

        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

async function init(input) {
    if (typeof input === 'undefined') {
        input = import.meta.url.replace(/\.js$/, '_bg.wasm');
    }
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_log_47e2fc9a446c5725 = function(arg0, arg1) {
        console.log(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_onTapeBlock_5fef6f07f2a38440 = function(arg0) {
        onTapeBlock(arg0 >>> 0);
    };
    imports.wbg.__wbg_putSoundData_bb8d87be37ea9d3e = function(arg0, arg1) {
        putSoundData(getArrayF32FromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_putImageData_2322fe355f860354 = function(arg0, arg1, arg2, arg3) {
        putImageData(arg0, arg1, getArrayU8FromWasm0(arg2, arg3));
    };
    imports.wbg.__wbg_alert_ddf2aa03d6bb8530 = function(arg0, arg1) {
        alert(getStringFromWasm0(arg0, arg1));
    };

    if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
        input = fetch(input);
    }

    const { instance, module } = await load(await input, imports);

    wasm = instance.exports;
    init.__wbindgen_wasm_module = module;

    return wasm;
}

export default init;

