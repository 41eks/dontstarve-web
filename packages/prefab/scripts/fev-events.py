#!/usr/bin/env python3
"""Resolve DST FMOD event paths to sound definitions, bank names and FEV file_index.

Port of AssetArchive's src-tauri/src/fmodparse.rs (FmodFev::parse). Event paths omit the
project name: use `wilson/hit`, not `dontstarve/wilson/hit`. file_index is zero-based;
vgmstream-cli -s is file_index + 1.

Usage: fev-events.py <file.fev> <event-path|substring>... [--substring]
"""
import struct, sys
class R:
    def __init__(s, d): s.d=d; s.p=0
    def seek(s, n):
        n=n.encode(); i=0
        while True:
            if s.p>=len(s.d): raise Exception('seek '+n.decode())
            b=s.d[s.p]; s.p+=1
            if b==n[i]:
                i+=1
                if i==len(n): return
            else: i=0
    def skip(s,n): s.p+=n
    def u32(s): v=struct.unpack_from('<I',s.d,s.p)[0]; s.p+=4; return v
    def u16(s): v=struct.unpack_from('<H',s.d,s.p)[0]; s.p+=2; return v
    def lbuf(s):
        n=s.u32(); b=s.d[s.p:s.p+n]; s.p+=n
        return b[:-1] if b.endswith(b'\0') else b
def parse(path):
    f=R(open(path,'rb').read())
    for t in ('RIFF','LIST','PROJ','OBCT'): f.seek(t)
    f.skip(20); nb=f.u32(); f.skip(4); nc=f.u32(); f.skip(4); f.u32(); f.skip(36); f.u32(); f.skip(28); f.u32(); f.skip(4); f.u32(); f.skip(28); f.u32(); f.skip(128); f.lbuf()
    f.seek('LGCY'); f.skip(12); f.lbuf(); f.skip(8)
    banks=[]
    for _ in range(nb): f.skip(20); banks.append(f.lbuf().decode())
    for _ in range(nc): f.lbuf(); f.skip(20)
    events=[]; stack_idx=[]
    def ev():
        t=f.u32()
        if t==16:
            ni=f.u32(); f.skip(160); num=f.u32(); di=f.u32(); f.skip(58); f.lbuf()
            events.append((stack_idx+[ni],[di]))
        elif t==8:
            ni=f.u32(); f.skip(160); nl=f.u32(); refs=[]
            for _ in range(nl):
                f.skip(6); w=f.u32(); ns=w&0xffff; ne=w>>16
                for _ in range(ns): refs.append(f.u16()); f.skip(56)
                for _ in range(ne):
                    f.skip(4); ln=f.u32(); f.skip(ln); f.skip(12); np_=f.u32(); f.skip(4*np_); f.skip(8)
            npar=f.u32(); f.skip(32*npar); f.skip(8); f.lbuf()
            events.append((stack_idx+[ni],refs))
        else: raise Exception('evt %d'%t)
    stack=[('S',f.u32())]
    while stack:
        k,v=stack.pop()
        if k=='H':
            gi=f.u32(); f.skip(4); nsg=f.u32(); ne=f.u32(); stack_idx.append(gi)
            stack.append(('E',ne)); stack.append(('S',nsg))
        elif k=='S':
            if v>0: stack.append(('S',v-1)); stack.append(('H',0))
        else:
            for _ in range(v): ev()
            stack_idx.pop()
    n=f.u32(); f.skip(74*n); nd=f.u32(); defs=[]
    for _ in range(nd):
        ni=f.u32(); f.u32(); nw=f.u32(); files=[]
        for _ in range(nw):
            t=f.u32(); f.u32()
            if t==0:
                p=f.lbuf().decode(errors='replace'); bi=f.u32(); fi=f.u32(); ln=f.u32()
                files.append((p,banks[bi],fi,ln))
            elif t==1: f.skip(8)
            elif t in (2,3): pass
            else: raise Exception('wf')
        defs.append(files)
    f.seek('EPRP'); f.seek('STRR'); ln=f.u32(); ns=f.u32()
    offs=[f.u32() for _ in range(ns)]
    content=f.d[f.p:f.p+ln-4-4*ns]
    strs=[]
    for i,o in enumerate(offs):
        e=offs[i+1] if i+1<len(offs) else len(content)
        strs.append(content[o:e].rstrip(b'\0').decode(errors='replace'))
    return {'/'.join(strs[i] for i in p):[(d,defs[d]) for d in r if d<len(defs)] for p,r in events}
if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--substring']
    substring = '--substring' in sys.argv
    if len(args) < 2: sys.exit(__doc__)
    events = parse(args[0])
    for query in args[1:]:
        keys = [k for k in events if query in k] if substring else [query]
        for key in keys:
            print(key)
            for definition, files in events.get(key, []):
                for path, bank, file_index, length_ms in files:
                    print(f'  sounddef {definition}: {path} bank={bank} file_index={file_index} '
                          f'vgmstream -s {file_index + 1} ({length_ms} ms)')
