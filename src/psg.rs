//Emulation of the AY-3-8910 programmable sound generator

struct FreqGen {
    divisor: u32,
    phase: u32,
}

impl FreqGen {
    fn new() -> FreqGen {
        FreqGen {
            divisor: 32,
            phase: 0,
        }
    }
    fn set_freq(&mut self, freq: u16) {
        self.divisor = 32 * u32::from(freq);
        self.phase = 0;
    }
    fn next_sample(&mut self, t: u32) -> bool {
        self.phase += t;
        while self.phase > self.divisor {
            self.phase -= self.divisor;
        }
        self.phase < self.divisor / 2
    }
}

struct NoiseGen {
    divisor: u32,
    shift: u32,
    level: bool,
    phase: u32,
}

impl NoiseGen {
    fn new() -> NoiseGen {
        NoiseGen {
            divisor: 32,
            shift: 1,
            level: false,
            phase: 0,
        }
    }
    fn set_freq(&mut self, freq: u8) {
        self.divisor = 32 * u32::from(freq);
        //log!("noise div {}", self.divisor);
    }
    fn next_sample(&mut self, t: u32) -> bool {
        self.phase += t;
        while self.phase > self.divisor {
            self.phase -= self.divisor;
            let bit0 = (self.shift & 1) != 0;
            let bit3 = (self.shift & 8) != 0;
            self.level ^= bit0;
            if bit0 ^ bit3 {
                self.shift ^= 0x10000;
            }
            self.shift >>= 1;
        }
        self.level
    }
}

enum EnvBlock {
    High,
    Low,
    Raise,
    Lower,
}

enum EnvShape {
    LowerLow,
    RaiseLow,
    LowerLoop,
    LowerRaiseLoop,
    LowerHigh,
    RaiseLoop,
    RaiseHigh,
    RaiseLowerLoop,
}

struct Envelope {
    divisor: u32,
    phase: u32,
    shape: EnvShape,
    step: u8,
    block: EnvBlock,
}


impl Envelope {
    fn new() -> Envelope {
        Envelope {
            divisor: 32,
            phase: 0,
            step: 0,
            shape: EnvShape::LowerLow,
            block: EnvBlock::Low,
        }
    }
    fn set_freq_shape(&mut self, freq: u16, shape: u8) {
        use self::{EnvShape::*, EnvBlock::*};
        self.divisor = 32 * u32::from(freq);
        self.phase = 0;
        self.step = 0;
        let (shape, block) = match shape & 0x0f {
            0x00 | 0x01 | 0x02 | 0x03 | 0x09 => (LowerLow, Lower),
            0x04 | 0x05 | 0x06 | 0x07 | 0x0f => (RaiseLow, Raise),
            0x08 => (LowerLoop, Lower),
            0x0a => (LowerRaiseLoop, Lower),
            0x0b => (LowerHigh, Lower),
            0x0c => (RaiseLoop, Raise),
            0x0d => (RaiseHigh, Raise),
            0x0e => (RaiseLowerLoop, Raise),
            0x10 ..= 0xff => unreachable!(),
        };
        self.shape = shape;
        self.block = block;
    }
    fn next_sample(&mut self, t: u32) -> u8 {
        use self::{EnvShape::*, EnvBlock::*};
        self.phase += t;
        while self.phase > self.divisor {
            self.phase -= self.divisor;
            self.step += 1;
            if self.step == 16 {
                self.step = 0;

                self.block = match self.shape {
                    LowerLow | RaiseLow => Low,
                    LowerHigh | RaiseHigh => High,
                    LowerLoop => Lower,
                    RaiseLoop => Raise,
                    LowerRaiseLoop | RaiseLowerLoop => match self.block {
                        Lower => Raise,
                        Raise => Lower,
                        _ => unreachable!(),
                    }
                };
            }
        }
        match self.block {
            Low => 0,
            High => 15,
            Raise => self.step,
            Lower => 15 - self.step,
        }
    }
}

/// The Programmable Sound Generator: AY-3-8910
pub struct Psg {
    /// The selected register, that will be read/written next
    reg_sel: u8,
    /// There are 16 byte-sized registers
    reg: [u8; 16],
    /// There are 3 frequency generators, this is the FG-A.
    freq_a: FreqGen,
    /// The second frequency generator FG-B
    freq_b: FreqGen,
    /// The third frequency generator FG-C
    freq_c: FreqGen,
    /// There is only one noise generator, shared by all the FG-*
    noise: NoiseGen,
    /// The envelope setup
    envelope: Envelope,
}

impl Psg {
    pub fn new() -> Psg {
        Psg {
            reg_sel: 0,
            reg: Default::default(),
            freq_a: FreqGen::new(),
            freq_b: FreqGen::new(),
            freq_c: FreqGen::new(),
            noise: NoiseGen::new(),
            envelope: Envelope::new(),
        }
    }
    pub fn load_snapshot(data: &[u8]) -> Psg {
        let mut psg = Self::new();
        for (r, &v) in data[1..17].iter().enumerate() {
            psg.reg_sel = r as u8;
            psg.write_reg(v);
        }
        psg.reg_sel = data[0];
        psg
    }
    pub fn snapshot(&self, data: &mut [u8]) {
        data[0] = self.reg_sel;
        data[1..17].copy_from_slice(&self.reg);
    }
    /// Changes the selected register
    pub fn select_reg(&mut self, reg: u8) {
        if let 0..=0x0f = reg {
            self.reg_sel = reg;
        }
    }
    /// Reads the selected register, it has no side effects
    pub fn read_reg(&self) -> u8 {
        // Some fancy programs, such as demos, try do detect if this is an original AY-3-8910 or
        // some clone like YM2149. They seem to regard the original as superior, so we try to
        // pose as such.
        // The trick is that some registers do not use the full 8-bits. In those the original chip
        // only stores the necessary bits while the clones keep them all. The program will
        // write a value such as 0xff and then read it back: if it gets the whole value it is
        // a clone.
        let r = self.reg[usize::from(self.reg_sel)];
        let r = match self.reg_sel {
            // high byte of a freq_12 and envelope shape only have 4 bits
            0x01 | 0x03 | 0x05 | 0x0d => r & 0x0f,
            // noise and volumes only use 5 bits
            0x06 | 0x08 | 0x09 | 0x0a => r & 0x1f,
            // all other registers use the full 8 bits
            _ => r
        };
        //log::info!("PSG read {:02x} -> {:02x}", self.reg_sel, r);
        r
    }
    /// Reads the selected register
    pub fn write_reg(&mut self, x: u8) {
        self.reg[usize::from(self.reg_sel)] = x;
        //log::info!("PSG write {:02x} <- {:02x}", self.reg_sel, x);
        match self.reg_sel {
            //Regs 0x00-0x01 set up the frequency for FG-A
            0x00 | 0x01 => {
                let freq = Self::freq_12(self.reg[0x00], self.reg[0x01]);
                self.freq_a.set_freq(freq);
                //log!("Tone A: {}", freq);
            }
            //Regs 0x02-0x03 set up the frequency for FG-B
            0x02 | 0x03 => {
                let freq = Self::freq_12(self.reg[0x02], self.reg[0x03]);
                self.freq_b.set_freq(freq);
                //log!("Tone B: {}", freq);
            }
            0x04 | 0x05 => {
            //Regs 0x04-0x05 set up the frequency for FG-C
            let freq = Self::freq_12(self.reg[0x04], self.reg[0x05]);
                self.freq_c.set_freq(freq);
                //log!("Tone C: {}", freq);
            }
            //Reg 0x06 is the noise frequency
            0x06 => {
                let noise = self.reg[0x06] & 0x1f;
                self.noise.set_freq(if noise == 0 { 1 } else { noise });
                //log!("Noise A: {}", noise);
            }
            //Regs 0x07-0x0a: are used directly in next_sample(), no side effects

            //Regs 0x0b-0x0c set up the envelope frequency; 0x0d is the shape noise
            0x0b | 0x0c | 0x0d=> {
                let freq = Self::freq_16(self.reg[0x0b], self.reg[0x0c]);
                let shape = self.reg[0x0d];
                self.envelope.set_freq_shape(freq, shape);
                //log!("Envel: {} {}", freq, shape);
            }
            //Regs 0x0e-0x0f are I/O ports, not used for music, other AY-3-891x do not even connect
            //these to the chip pins
            _ => {}
        }
    }
    pub fn next_sample(&mut self, t: u32) -> u16 {
        //Reg 0x07 is a bitmask that _disables_ what is to be mixed to the final output:
        // * 0b0000_0001: do not mix freq_a
        // * 0b0000_0010: do not mix freq_b
        // * 0b0000_0100: do not mix freq_c
        // * 0b0000_1000: do not mix noise into channel A
        // * 0b0001_0000: do not mix noise into channel B
        // * 0b0010_0000: do not mix noise into channel C
        // * 0b1100_0000: unused
        let mix = self.reg[0x07];
        let tone_a = (mix & 0x01) == 0;
        let tone_b = (mix & 0x02) == 0;
        let tone_c = (mix & 0x04) == 0;
        let noise_a = (mix & 0x08) == 0;
        let noise_b = (mix & 0x10) == 0;
        let noise_c = (mix & 0x20) == 0;

        // If any noise bit is set, compute the next noise sample.
        // It not, do not bother, because it is just noise.
        let noise = if noise_a || noise_b || noise_c {
            self.noise.next_sample(t)
        } else {
            false
        };

        // Compute which channels are to be added
        let chan_a = Self::channel(tone_a, noise_a, &mut self.freq_a, noise, t);
        let chan_b = Self::channel(tone_b, noise_b, &mut self.freq_b, noise, t);
        let chan_c = Self::channel(tone_c, noise_c, &mut self.freq_c, noise, t);

        //Envelope is computed even if unused
        let env = self.envelope.next_sample(t);

        // Add the enabled channels, pondering the volume and the envelope
        let mut res : u16 = 0;
        if chan_a {
            let v = self.reg[0x08];
            let vol = Self::volume(v, env);
            res += vol;
        }
        if chan_b {
            let v = self.reg[0x09];
            let vol = Self::volume(v, env);
            res += vol;
        }
        if chan_c {
            let v = self.reg[0x0a];
            let vol = Self::volume(v, env);
            res += vol;
        }
        res
    }
    fn volume(v: u8, env: u8) -> u16 {
        let v = if v & 0x10 != 0 {
            env
        } else {
            v & 0x0f
        };
        //The volume curve is an exponential where each level is sqrt(2) lower than the next,
        //but with an offset so that the first one is 0. computed with this python line:
        //>>> [round(8192*exp(i/2-7.5)) for i in range(0, 16)]
        const LEVELS: [u16; 16] = [5, 7, 12, 20, 33, 55, 91, 150, 247, 408, 672, 1109, 1828, 3014, 4969, 8192];
        LEVELS[usize::from(v)]
    }
    fn freq_12(a: u8, b: u8) -> u16 {
        let n = u16::from(a) | (u16::from(b & 0x0f) << 8);
        if n == 0 { 1 } else { n }
    }
    fn freq_16(a: u8, b: u8) -> u16 {
        let n = u16::from(a) | (u16::from(b) << 8);
        if n == 0 { 1 } else { n }
    }
    fn channel(tone_enabled: bool, noise_enabled: bool, freq: &mut FreqGen, noise: bool, t: u32) -> bool {
        if tone_enabled {
            let tone = freq.next_sample(t);
            if noise_enabled {
                tone && noise
            } else {
                tone
            }
        } else if noise_enabled {
            noise
        } else {
            true
        }
    }
}
