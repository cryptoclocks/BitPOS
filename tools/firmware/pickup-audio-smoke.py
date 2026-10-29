#!/usr/bin/env python3
"""Compile real cue synthesis/queue/playback with host I2S adapters; no audible claim."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'device/firmware/main/bitpos_audio.c').read_text()

def function(name):
    start = source.rfind('\n', 0, source.index(name + '(')) + 1
    opening = source.index('{', start)
    depth, end = 1, opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end] + '\n'

header = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdatomic.h>
#include <math.h>
typedef int esp_err_t;
typedef int i2s_chan_handle_t;
typedef int QueueHandle_t;
enum {ESP_OK=0};
static unsigned queued;
static uint8_t request_copy[256],output[32768];
static size_t output_size;
static bool short_write;
static unsigned uxQueueMessagesWaiting(QueueHandle_t queue){(void)queue;return queued;}
static esp_err_t i2s_channel_write(i2s_chan_handle_t channel,const void *data,size_t size,size_t *written,unsigned timeout){
    (void)channel;assert(timeout==100&&output_size+size<=sizeof(output));
    *written=short_write?size-1:size;memcpy(output+output_size,data,*written);output_size+=*written;return ESP_OK;
}
'''
# Actual declarations, permission gates and callback-independent synthesis.
declarations = source[source.index('#define ORDER_ID_SIZE'):source.index('static uint16_t le16')]
queue = r'''
static int xQueueSend(QueueHandle_t queue,const void *request,unsigned timeout){
    assert(queue==1&&timeout==0&&sizeof(audio_request_t)<=sizeof(request_copy));
    memcpy(request_copy,request,sizeof(audio_request_t));queued++;return 1;
}
'''
functions = ''.join(function(name) for name in [
    'write_pcm', 'play_native', 'bitpos_audio_set_muted', 'bitpos_audio_set_pickup',
    'enqueue_cue', 'bitpos_audio_play_success', 'bitpos_audio_play_pickup'])
synthesis = source[source.index('    for(unsigned tone = 0; tone < 2; tone++)'):source.index('    i2s_chan_config_t channel')]
main = r'''
static double energy(const int16_t *samples,unsigned frames,double frequency){
    double real=0,imaginary=0;for(unsigned i=0;i<frames;i++){
        double angle=2*3.141592653589793*frequency*i/SAMPLE_RATE;
        real+=samples[i*2]*cos(angle);imaginary+=samples[i*2]*sin(angle);
    }return real*real+imaginary*imaginary;
}
int main(void){
    synthesize();atomic_store(&published_queue,1);
    assert(sizeof(pickup_cue)==10240&&sizeof(native_cue)==20480);
    assert(PICKUP_FRAMES*2*1000/SAMPLE_RATE==160);
    assert(energy(pickup_cue,PICKUP_FRAMES,1319)>100*energy(pickup_cue,PICKUP_FRAMES,784));
    assert(energy(pickup_cue+PICKUP_FRAMES*2,PICKUP_FRAMES,988)>100*energy(pickup_cue+PICKUP_FRAMES*2,PICKUP_FRAMES,1046));
    for(unsigned i=0;i<PICKUP_FRAMES*2;i++)assert(pickup_cue[i*2]==pickup_cue[i*2+1]);
    bitpos_audio_play_pickup("pickup:fixture");assert(!queued); /* inactive scene */
    bitpos_audio_set_pickup(true);bitpos_audio_play_pickup("pickup:fixture");assert(queued==1);
    audio_request_t request;memcpy(&request,request_copy,sizeof(request));assert(request.pickup&&!request.attract&&!request.version);
    size_t bytes=0;assert(play_native(&request,&bytes)==PLAY_COMPLETE&&bytes==sizeof(pickup_cue)&&output_size==bytes);
    assert(!memcmp(output,pickup_cue,bytes));puts("actual_pickup_PCM_160ms_descending_1319_988_stereo_not_paid_320ms_784_1046");
    bitpos_audio_set_pickup(false);bitpos_audio_set_pickup(true);bytes=0;
    assert(play_native(&request,&bytes)==PLAY_CANCELLED&&!bytes);puts("displaced_pickup_epoch_cancels_old_request_even_after_reactivation");
    bitpos_audio_play_pickup("pickup:new");memcpy(&request,request_copy,sizeof(request));
    bitpos_audio_set_muted(true);bitpos_audio_set_muted(false);bytes=0;
    assert(play_native(&request,&bytes)==PLAY_CANCELLED&&!bytes);puts("mute_epoch_cancels_old_pickup_after_unmute");
    bitpos_audio_play_success("fixture-order",3);memcpy(&request,request_copy,sizeof(request));
    bitpos_audio_set_pickup(false);output_size=bytes=0;
    assert(!request.pickup&&request.version==3&&play_native(&request,&bytes)==PLAY_COMPLETE&&bytes==sizeof(native_cue));
    assert(!memcmp(output,native_cue,bytes));puts("pickup_scene_cancellation_does_not_cancel_or_change_financial_success_PCM");
    bitpos_audio_set_pickup(true);bitpos_audio_play_pickup("pickup:short");memcpy(&request,request_copy,sizeof(request));
    output_size=bytes=0;short_write=true;assert(play_native(&request,&bytes)==PLAY_OUTPUT_FAILED&&bytes==CHUNK_BYTES-1);
    unsigned before=queued;bitpos_audio_play_pickup("bad\nID");assert(queued==before);
    puts("pickup_short_I2S_write_reports_failure_invalid_effect_does_not_enqueue_host_only");return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='bitpos-pickup-audio-') as directory:
    temp = Path(directory)
    (temp / 'smoke.c').write_text(header + declarations + queue + functions + '\nstatic void synthesize(void){\n' + synthesis + '}\n' + main)
    subprocess.run(['cc', '-std=c11', '-fsanitize=address,undefined', '-g', str(temp / 'smoke.c'), '-lm', '-o', str(temp / 'smoke')], check=True)
    result = subprocess.run([str(temp / 'smoke')], text=True, capture_output=True, check=True,
                            env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'})
proof = {'origin': 'actual_firmware_pickup_audio_functions_host_I2S_fixture',
         'checks': result.stdout.strip().splitlines(), 'sanitizers': ['ASan', 'UBSan'],
         'physical_audio_claim': False}
(ROOT / '.omp/work/evidence/firmware-pickup-audio-smoke.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
