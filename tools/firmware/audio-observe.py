#!/usr/bin/env python3
"""Observe only Mac microphone; retain numeric cue correlation, never raw audio.

A detected approved cue is a candidate, not payment/audio-source attribution.
Parent must correlate its window with the physical ESP32 order-specific WAV log.
No camera, loopback, USB write, replay or output sound is used.
"""
import argparse, hashlib, json, subprocess, time, wave
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--seconds',type=int,default=45,choices=range(2,61))
p.add_argument('--name',required=True)
a=p.parse_args()
if not a.name.replace('-','').replace('_','').isalnum():raise SystemExit('Invalid evidence name')
output=Path('.omp/work/evidence')/(a.name+'.json')
if output.exists():raise SystemExit('Evidence already exists')
source=Path('asset-pack/audio/payment-success-device.wav')
assert hashlib.sha256(source.read_bytes()).hexdigest()=='aa78633e92f389a5edc9216aa5068c0493ef1b17a661ebfcf81f0364e82af402'
with wave.open(str(source),'rb') as w:
 assert (w.getframerate(),w.getsampwidth(),w.getnchannels(),w.getnframes())==(16000,2,2,5120)
 reference=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').reshape(-1,2).mean(axis=1)/32768.0
start=datetime.now(timezone.utc);begin=time.monotonic()
try:
 result=subprocess.run(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-f','avfoundation','-i',':0','-t',str(a.seconds),'-vn','-ac','1','-ar','16000','-af','aresample=async=1:first_pts=0','-f','f32le','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=a.seconds+15)
except subprocess.TimeoutExpired:
 raise SystemExit('Microphone capture timed out; raw audio not retained') from None
if result.returncode or len(result.stdout)<5120*4:raise SystemExit('Microphone unavailable; raw diagnostics withheld')
samples=np.frombuffer(result.stdout,dtype='<f4').astype(np.float64)
# Compare the unique complete 320ms approved cue, not amplitude/loudness alone.
# Remove DC/room bass identically from source and microphone in the FFT domain.
def bandpass(values):
 frequencies=np.fft.rfftfreq(len(values),1/16000)
 spectrum=np.fft.rfft(values);spectrum[(frequencies<300)|(frequencies>3500)]=0
 return np.fft.irfft(spectrum,n=len(values))
samples=bandpass(samples);reference=bandpass(reference);reference-=reference.mean()
n=len(samples);m=len(reference);size=1<<(n+m-2).bit_length()
correlation=np.fft.irfft(np.fft.rfft(samples,size)*np.fft.rfft(reference[::-1],size),size)[m-1:n]
energy=np.concatenate(([0.0],np.cumsum(samples*samples)));window_energy=energy[m:]-energy[:-m]
normalizer=np.sqrt(np.maximum(window_energy,0)*np.dot(reference,reference))
normalized=np.divide(np.abs(correlation),normalizer,out=np.zeros_like(correlation),where=normalizer>1e-9)
peak=int(np.argmax(normalized));score=float(normalized[peak]);offset=peak/16000
proof={'origin':'physical_mac_microphone_capture','device':'AVFoundation audio0 MacBook Pro Microphone','started_at':start.isoformat(),'requested_seconds':a.seconds,'captured_samples':n,'sample_rate':16000,'wall_seconds':time.monotonic()-begin,'reference_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'reference_duration_ms':320,'peak_offset_seconds':offset,'peak_normalized_full_cue_correlation':score,'candidate_threshold':0.20,'candidate_detected':score>=0.20,'attribution':'Parent must correlate microphone window with order-specific physical ESP32 WAV completion; this file alone does not prove source or dedup','raw_audio_persisted':False,'observer_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
# Drop raw PCM before retaining only public scalar evidence.
del result,samples,reference,correlation,normalized,energy,window_energy,normalizer
output.write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
