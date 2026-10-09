"""Bounded public BitPOS USB I/O; no modem-line, reset or flash operations."""
import contextlib
import fcntl
import os
import select
import termios
import time

PORT='/dev/cu.usbmodem101'

class SerialPort:
    def __init__(self):
        self.fd=None
        self.pending=bytearray()

    def __enter__(self):
        self.fd=os.open(PORT,os.O_RDWR|os.O_NOCTTY|os.O_NONBLOCK)
        try:
            fcntl.ioctl(self.fd,termios.TIOCEXCL)
            attrs=termios.tcgetattr(self.fd)
            attrs[0]=attrs[1]=attrs[3]=0
            attrs[2]=termios.CS8|termios.CREAD|termios.CLOCAL
            attrs[4]=attrs[5]=termios.B115200
            attrs[6][termios.VMIN]=attrs[6][termios.VTIME]=0
            termios.tcsetattr(self.fd,termios.TCSANOW,attrs)
            return self
        except BaseException:
            os.close(self.fd);self.fd=None
            raise

    def __exit__(self,*_):
        with contextlib.suppress(OSError):
            fcntl.ioctl(self.fd,termios.TIOCNXCL)
        os.close(self.fd);self.fd=None
        # Keep HUPCL disabled. OS behavior is observed, not asserted by source.

    def read(self,count):
        if not select.select([self.fd],[],[],0.05)[0]:return b''
        try:data=os.read(self.fd,count)
        except BlockingIOError:return b''
        if not data:raise OSError('BitPOS USB disconnected')
        return data

    def write(self,data):
        until=time.monotonic()+1;offset=0
        while offset<len(data):
            remaining=until-time.monotonic()
            if remaining<=0 or not select.select([],[self.fd],[],remaining)[1]:
                raise OSError('BitPOS USB write deadline exceeded')
            try:count=os.write(self.fd,data[offset:])
            except BlockingIOError:continue
            if count<=0:raise OSError('BitPOS USB disconnected')
            offset+=count
        return offset

    def readline(self):
        until=time.monotonic()+1
        while time.monotonic()<until:
            at=self.pending.find(b'\n')
            if at>=0:
                line=bytes(self.pending[:at+1]);del self.pending[:at+1]
                return line
            self.pending.extend(self.read(1024))
            if len(self.pending)>4096:self.pending.clear()
        return b''
