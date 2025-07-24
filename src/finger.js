import { drumPatterns, synthPatterns } from './patterns.js';
import drum, {
    DRUM_HAND_LEFT,
    DRUM_HAND_RIGHT,
    COWBELL,
    FACE
} from './drum.js';
import {
    SYNTH_LEFT,
    SYNTH_BITS_LEFT,
    KEY_GUIDE,
    SYNTH_IDLE_HAND_LEFT,
    SYNTH_IDLE_HAND_RIGHT,
    SYNTH_PLAY_HAND_LEFT,
    SYNTH_PLAY_HAND_RIGHT
} from './synth.js';
import MIDI, { whiteKeys, idxToMidi } from './midi.js';
import css from './finger.css.js';
import * as c from './constants.js';
import { asArrayLike, stringBool } from './utils.js';

// Private symbols to not expose every variable to the outside
const [
    $playback,
    $hold,
    $timer,
    $displayInstrument,
    $bpm,
    $stepDuration,
    $midi,
    $controlChannel,
    $resizeTimeout,
    $noteScheduled
] = [
    Symbol('playback'),
    Symbol('hold'),
    Symbol('timer'),
    Symbol('displayInstrument'),
    Symbol('bpm'),
    Symbol('stepDuration'),
    Symbol('midi'),
    Symbol('controlChannel'),
    Symbol('resizeTimeout'),
    Symbol('noteScheduled')
];

const [
    $drumPlayback,
    $drumPlayhead,
    $drumPattern,
    $activeDrumNotes,
    $drumChannel
] = [
    Symbol('drumPlayback'),
    Symbol('drumPlayhead'),
    Symbol('drumPattern'),
    Symbol('activeDrumNotes'),
    Symbol('drumChannel')
];

const [
    $synthPlayback,
    $synthPlayhead,
    $synthPattern,
    $activeSynthNotes,
    $synthChannel,
    $synthKeyX
] = [
    Symbol('synthPlayback'),
    Symbol('synthPlayhead'),
    Symbol('synthPattern'),
    Symbol('activeSynthNotes'),
    Symbol('synthChannel'),
    Symbol('synthKeyX')
];

class Finger extends HTMLElement {
    static get observedAttributes() {
        return [
            'playback',
            'drum-pattern',
            'synth-pattern',
            'bpm',
            'display-instrument'
        ];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `<style>${css}</style><slot></slot>`;

        this[$playback] = false;
        this[$hold] = false;
        this[$timer] = null;
        this[$displayInstrument] = 'drum';
        this[$bpm] = 120;
        this[$stepDuration] = 0;
        this[$midi] = null;
        this[$controlChannel] = 1;
        this[$resizeTimeout] = null;
        this[$noteScheduled] = {};

        this[$drumPlayback] = false;
        this[$drumPlayhead] = 0;
        this[$drumPattern] = 0;
        this[$activeDrumNotes] = new Set();
        this[$drumChannel] = 10;

        this[$synthPlayback] = false;
        this[$synthPlayhead] = 0;
        this[$synthPattern] = 0;
        this[$activeSynthNotes] = new Set();
        this[$synthChannel] = 1;
        this[$synthKeyX] = 0;

        this._initMIDI();
    }

    connectedCallback() {
        // Any DOM setup or event listeners
    }

    attributeChangedCallback(name, oldVal, newVal) {
        switch (name) {
            case 'playback':
                this.playback = stringBool(newVal);
                break;
            case 'drum-pattern':
                this.drumPattern = parseInt(newVal, 10);
                break;
            case 'synth-pattern':
                this.synthPattern = parseInt(newVal, 10);
                break;
            case 'bpm':
                this.bpm = parseInt(newVal, 10);
                break;
            case 'display-instrument':
                this.displayInstrument = newVal;
                break;
        }
    }

    set playback(playback) {
        this[$playback] = playback;
        // Start/stop logic here
    }
    get playback() {
        return this[$playback];
    }

    set drumPattern(drumPattern) {
        this[$drumPattern] = drumPattern;
    }
    get drumPattern() {
        return this[$drumPattern];
    }

    set synthPattern(synthPattern) {
        this[$synthPattern] = synthPattern;
    }
    get synthPattern() {
        return this[$synthPattern];
    }

    set bpm(bpm) {
        this[$bpm] = bpm;
    }
    get bpm() {
        return this[$bpm];
    }

    set displayInstrument(displayInstrument) {
        this[$displayInstrument] = displayInstrument;
    }
    get displayInstrument() {
        return this[$displayInstrument];
    }

    _initMIDI() {
        this[$midi] = new MIDI();
        this[$midi].noteTimestamp = 0;

        // Assign custom handlers
        this[$midi].noteon = (channel, note) => {
            // Your app logic for note on
        };
        this[$midi].noteoff = (channel, note) => {
            // Your app logic for note off
        };

        // Re-bind MIDI input listeners to use the updated handlers
        const midiInstance = this[$midi];
        const midiAccess = midiInstance && midiInstance[Object.getOwnPropertySymbols(midiInstance)[0]];
        if (midiAccess) {
            for (const input of midiAccess.inputs.values()) {
                input.onmidimessage = midiInstance.message.bind(midiInstance);
            }
        }
    }
}

customElements.define('finger-sequencer', Finger);