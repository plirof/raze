#![allow(unused)]
#![warn(unreachable_patterns)]
extern crate png;
#[cfg(feature="zip")]
extern crate zip;

use std::env;
use std::io::{self, BufWriter, Write, BufReader, Read, ErrorKind};
use std::fs::File;
use std::path::Path;

use png::HasParameters;

#[macro_use]
mod logger {
    macro_rules! log {
        ( $($e:tt)* ) => {
            println!($($e)*)
        };
    }
}

mod memory;
mod z80;
mod tape;

use memory::Memory;
use z80::{Z80, Bus};

fn write_screen(path: impl AsRef<Path>, data: &[u8]) -> io::Result<()> {
    let file = File::create(path)?;
    let mut w = BufWriter::new(file);
    //w.write_all(data)?;

    let mut encoder = png::Encoder::new(w, 256, 192);
    encoder.set(png::ColorType::Grayscale).set(png::BitDepth::Eight);
    let mut writer = encoder.write_header()?;

    let mut ps = vec![0; 256 * 192 * 1];
    for y in 0..192 {
        let orow = match y {
            0..=63 => {
                let y = (y % 8) * 256 + (y / 8) * 32;
                y
            }
            64..=127 => {
                let y = y - 64;
                let y = (y % 8) * 256 + (y / 8) * 32;
                y + 64 * 32
            }
            128..=191 => {
                let y = y - 128;
                let y = (y % 8) * 256 + (y / 8) * 32;
                y + 128 * 32
            }
            _ => unreachable!()
        };
        for x in 0..32 {
            let attr = data[192 * 32 + (y / 8) * 32 + x];
            let d = data[orow + x];
            for b in 0..8 {
                let pix = ((d >> (7-b)) & 1) != 0;
                let pixo = (256 * y + 8*x + b) * 1;
                if pix {
                    ps[pixo + 0] = (attr & 0b0000_0111) << 5;
                    //ps[pixo + 1] = 0x00;
                    //ps[pixo + 2] = 0x00;
                } else {
                    ps[pixo + 0] = (attr & 0b0011_1000) << 2;
                    //ps[pixo + 1] = 0xff;
                    //ps[pixo + 2] = 0xff;
                }
            }
        }
    }
    writer.write_image_data(&ps)?;
    Ok(())
}

struct Spectrum {
    x: i32,
    memory: Memory,
}

impl Bus for Spectrum {
    fn do_in(&mut self, port: impl Into<u16>) -> u8 {
        let port = port.into();
        let lo = port as u8;
        let hi = (port >> 8) as u8;
        let r = match lo {
            0xfe => {
                match hi {
                    0xdf => {
                        if 5 < self.x && self.x < 600 {
                            0xfe //P
                        } else {
                            0xff
                        }
                    }
                    0xf7 => {
                        if 700 < self.x && self.x < 750 {
                            0xfd //2
                        } else {
                            0xff
                        }
                    }
                    0xef => {
                        if 800 < self.x && self.x < 850 {
                            0xfe //0
                        } else {
                            0xff
                        }
                    }
                    0xbf => {
                        if 900 < self.x && self.x < 1000 {
                            0xfe //enter
                        } else {
                            0xff
                        }
                    }
                    _ => 0xff,
                }
            }
            _ => 0xff,
        };
        //println!("IN {:04x}, {:02x}", port, r);
        self.x += 1;
        r
    }
    fn do_out(&mut self, _port: impl Into<u16>, _value: u8) {
        //println!("OUT {:04x}, {:02x}", port, value);
    }
    fn peek(&mut self, addr: impl Into<u16>) -> u8 {
        self.memory.peek(addr)
    }
    fn poke(&mut self, addr: impl Into<u16>, value: u8) {
        self.memory.poke(addr, value);
    }
}

fn main() -> io::Result<()> {
    let mut args = env::args_os();
    let _program = args.next().ok_or(ErrorKind::InvalidData)?;
    let mut z80 = Z80::new();
    let mut memory;

    let load = args.next();
    match load {
        None => {
            memory = Memory::new_from_bytes(include_bytes!("48k.rom"), None)
        }
        Some(load) => {
            //let load = File::open(load)?;
            //let mut load = BufReader::new(load);
            let data = std::fs::read(&load)?;
            tape::Tape::new(&mut io::Cursor::new(data))?;
            return Ok(());
            //memory = Memory::load(&mut load)?;
            //z80.load(&mut load)?;
            //spectrum.load(&mut load)?;
        }
    }
    let mut spectrum = Spectrum { x: 0, memory };

    const SCROPS : i32 = 5_000;
    for count in 0 .. 200_000_000 {
        //z80.dump_regs();
        z80.exec(&mut spectrum);
        if (count+1) % SCROPS == 0 {
            if false {
                let screen = spectrum.memory.video_memory();
                write_screen(format!("scr{:06}.png", count / SCROPS), screen)?;
            }
            z80.interrupt(&mut spectrum);
        }
    }

    let save = File::create("save.spec")?;
    let mut save = BufWriter::new(save);
    spectrum.memory.save(&mut save)?;
    z80.save(&mut save)?;
    //spectrum.save(&mut save)?;

    Ok(())
}
