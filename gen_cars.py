#!/usr/bin/env python3
"""
GHOST — High quality 3D car sprites.
Each SVG is 256×256. Car faces UP (front at top).
Camera: above-right, showing roof + right-side panel + front face.
Uses bezier curves for realistic silhouettes.
"""
import os, math

OUT = '/Users/maverick/radar/public/cars'
os.makedirs(OUT, exist_ok=True)

def h2r(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def r2h(rgb): return '#{:02x}{:02x}{:02x}'.format(*[min(255,max(0,int(c))) for c in rgb])

def lt(c, f): return tuple(min(255, int(v + (255-v)*f)) for v in c)
def dk(c, f): return tuple(max(0, int(v*(1-f))) for v in c)

def cs(c, a=1.0):
    r,g,b = [min(255,max(0,int(v))) for v in c]
    return f'rgba({r},{g},{b},{a:.2f})' if a < 1 else f'rgb({r},{g},{b})'


# ── Car body shapes — bezier SVG paths ────────────────────────────────────────
# All 256×256. Car faces UP (front=top, rear=bottom).
# Each dict has: body, cabin, windshield, rear_win, panel (right-side 3D face)
# Wheel positions: list of (cx,cy) for [FL, FR, RL, RR]

SHAPES = {

'supercar': dict(
    # Ferrari/Lambo: long nose, wide rear haunches, low flat cab
    body  = 'M128,22 C116,22 96,32 88,46 C78,64 70,88 66,110 C62,132 62,152 64,170 C68,186 78,200 92,210 C104,218 116,222 128,222 C140,222 152,218 164,210 C178,200 188,186 192,170 C194,152 194,132 190,110 C186,88 178,64 168,46 C160,32 140,22 128,22Z',
    cabin = 'M104,108 C108,96 118,90 128,90 C138,90 148,96 152,108 L155,172 C151,182 141,188 128,188 C115,188 105,182 101,172Z',
    windshield = 'M106,108 C110,96 119,89 128,89 C137,89 146,96 150,108 L152,124 C148,130 139,134 128,134 C117,134 108,130 104,124Z',
    rear_win   = 'M103,160 C107,150 117,145 128,145 C139,145 149,150 153,160 L154,172 C150,182 140,188 128,188 C116,188 106,182 102,172Z',
    panel = 'M168,46 C178,60 186,88 190,110 C194,130 194,152 192,170 C188,186 178,200 164,210 L174,218 C190,208 202,190 206,168 C210,148 210,124 206,100 C202,76 194,50 182,36Z',
    wheels=[(72,88),(184,88),(68,178),(188,178)], wr=22,
    hl=[(88,28),(160,28)], tl=[(92,214),(164,214)],
    door='M102,136 Q128,132 154,136',
    grille='M104,30 L152,30 L156,40 L100,40Z',
    hood_line='M116,40 L128,22 L140,40',
),

'coupe': dict(
    # BMW/Porsche: balanced sports car, longer roof, slight fastback
    body  = 'M128,24 C118,24 100,34 92,48 C82,66 74,90 70,114 C67,136 67,156 70,174 C74,190 84,204 98,213 C110,220 120,224 128,224 C136,224 146,220 158,213 C172,204 182,190 186,174 C189,156 189,136 186,114 C182,90 174,66 164,48 C156,34 138,24 128,24Z',
    cabin = 'M102,106 C106,94 117,88 128,88 C139,88 150,94 154,106 L157,175 C153,185 142,192 128,192 C114,192 103,185 99,175Z',
    windshield = 'M104,106 C108,94 118,88 128,88 C138,88 148,94 152,106 L154,122 C150,130 140,135 128,135 C116,135 106,130 102,122Z',
    rear_win   = 'M101,162 C105,152 116,146 128,146 C140,146 151,152 155,162 L157,175 C153,185 142,192 128,192 C114,192 103,185 99,175Z',
    panel = 'M164,48 C174,66 182,90 186,114 C189,136 189,156 186,174 C182,190 172,204 158,213 L168,222 C184,212 196,196 200,174 C204,152 204,130 200,106 C196,80 188,56 178,40Z',
    wheels=[(74,90),(182,90),(70,180),(186,180)], wr=21,
    hl=[(90,30),(162,30)], tl=[(94,216),(162,216)],
    door='M100,137 Q128,133 156,137',
    grille='M106,32 L150,32 L154,42 L102,42Z',
    hood_line='M118,42 L128,24 L138,42',
),

'muscle': dict(
    # Challenger/Mustang: very wide, boxy, flat roof, broad front
    body  = 'M128,26 C112,26 90,36 82,52 C72,72 64,98 62,122 C60,144 62,164 66,180 C72,196 84,208 98,216 C110,222 120,226 128,226 C136,226 146,222 158,216 C172,208 184,196 190,180 C194,164 196,144 194,122 C192,98 184,72 174,52 C166,36 144,26 128,26Z',
    cabin = 'M100,108 C104,96 116,90 128,90 C140,90 152,96 156,108 L158,172 C154,182 142,188 128,188 C114,188 102,182 98,172Z',
    windshield = 'M102,107 C106,95 116,89 128,89 C140,89 150,95 154,107 L156,120 C152,128 140,133 128,133 C116,133 104,128 100,120Z',
    rear_win   = 'M100,160 C104,150 115,144 128,144 C141,144 152,150 156,160 L157,172 C153,182 141,188 128,188 C115,188 103,182 99,172Z',
    panel = 'M174,52 C184,72 192,98 194,122 C196,144 194,164 190,180 C184,196 172,208 158,216 L168,226 C186,216 200,200 206,180 C212,160 212,136 210,112 C208,86 200,58 188,40Z',
    wheels=[(66,94),(190,94),(62,182),(194,182)], wr=24,
    hl=[(84,34),(170,34)], tl=[(88,218),(168,218)],
    door='M98,136 Q128,132 158,136',
    grille='M96,36 L160,36 L164,50 L92,50Z',
    hood_line=None,
),

'sedan': dict(
    # BMW 7/S-Class: formal, upright, long wheelbase
    body  = 'M128,24 C118,24 102,32 96,46 C86,64 80,88 78,112 C76,134 76,156 80,174 C84,190 94,204 108,212 C116,218 122,222 128,222 C134,222 140,218 148,212 C162,204 172,190 176,174 C180,156 180,134 178,112 C176,88 170,64 160,46 C154,32 138,24 128,24Z',
    cabin = 'M104,104 C108,94 118,88 128,88 C138,88 148,94 152,104 L154,180 C150,190 140,196 128,196 C116,196 106,190 102,180Z',
    windshield = 'M106,104 C110,94 119,88 128,88 C137,88 146,94 150,104 L152,118 C148,126 138,130 128,130 C118,130 108,126 104,118Z',
    rear_win   = 'M104,166 C108,156 118,150 128,150 C138,150 148,156 152,166 L153,180 C149,190 139,196 128,196 C117,196 107,190 103,180Z',
    panel = 'M160,46 C170,64 176,88 178,112 C180,134 180,156 176,174 C172,190 162,204 148,212 L158,220 C174,212 186,196 190,172 C194,150 194,128 192,104 C190,78 184,52 174,34Z',
    wheels=[(80,88),(176,88),(76,178),(180,178)], wr=20,
    hl=[(96,30),(156,30)], tl=[(98,214),(158,214)],
    door='M102,132 Q128,128 154,132 M102,164 Q128,160 154,164',
    grille='M108,30 L148,30 L152,42 L104,42Z',
    hood_line=None,
),

'suv': dict(
    # Range Rover/G-Wagon: very boxy, tall, squared-off corners
    body  = 'M128,22 C114,22 94,28 86,42 C76,60 70,84 68,108 C66,130 66,154 70,174 C74,192 84,208 100,218 C110,224 120,228 128,228 C136,228 146,224 156,218 C172,208 182,192 186,174 C190,154 190,130 188,108 C186,84 180,60 170,42 C162,28 142,22 128,22Z',
    cabin = 'M98,100 C102,88 114,82 128,82 C142,82 154,88 158,100 L160,188 C156,198 144,204 128,204 C112,204 100,198 96,188Z',
    windshield = 'M100,100 C104,88 114,82 128,82 C142,82 152,88 156,100 L158,114 C154,122 142,127 128,127 C114,127 102,122 98,114Z',
    rear_win   = 'M98,172 C102,162 113,156 128,156 C143,156 154,162 158,172 L159,188 C155,198 143,204 128,204 C113,204 101,198 97,188Z',
    panel = 'M170,42 C180,60 186,84 188,108 C190,130 190,154 186,174 C182,192 172,208 156,218 L168,228 C186,218 198,200 202,178 C206,156 206,128 204,104 C202,78 196,52 184,34Z',
    wheels=[(70,90),(186,90),(66,182),(190,182)], wr=25,
    hl=[(86,28),(170,28)], tl=[(90,220),(166,220)],
    door='M96,128 Q128,124 160,128 M96,170 Q128,166 160,170',
    grille='M94,30 L162,30 L166,44 L90,44Z',
    hood_line=None,
),

'hypercar': dict(
    # Bugatti/McLaren: extremely flat, ultra-wide rear, tiny cab
    body  = 'M128,22 C112,22 88,34 80,50 C68,72 60,100 58,126 C56,150 58,170 64,186 C70,200 82,210 96,216 C108,220 118,224 128,224 C138,224 148,220 160,216 C174,210 186,200 192,186 C198,170 200,150 198,126 C196,100 188,72 176,50 C168,34 144,22 128,22Z',
    cabin = 'M108,110 C112,99 120,93 128,93 C136,93 144,99 148,110 L149,166 C146,176 138,182 128,182 C118,182 110,176 107,166Z',
    windshield = 'M109,110 C113,99 120,93 128,93 C136,93 143,99 147,110 L148,122 C145,130 137,135 128,135 C119,135 111,130 108,122Z',
    rear_win   = 'M108,154 C111,145 119,140 128,140 C137,140 145,145 148,154 L149,165 C146,175 138,181 128,181 C118,181 110,175 107,165Z',
    panel = 'M176,50 C188,72 196,100 198,126 C200,150 198,170 192,186 C186,200 174,210 160,216 L172,226 C190,218 204,204 210,182 C216,160 216,132 214,104 C212,74 204,44 190,28Z',
    wheels=[(64,100),(192,100),(60,182),(196,182)], wr=23,
    hl=[(82,28),(170,28)], tl=[(86,218),(170,218)],
    door='M107,134 Q128,130 149,134',
    grille='M96,30 L160,30 L166,46 L90,46Z',
    hood_line='M112,46 L128,22 L144,46',
),

'truck': dict(
    # F-150/Raptor: high ground clearance, long bed, squared cab
    body  = 'M128,18 C112,18 90,24 82,38 C72,56 68,80 66,104 C64,126 64,146 66,162 C70,176 78,186 88,192 C100,198 114,200 128,200 C142,200 156,198 168,192 C178,186 186,176 190,162 C192,146 192,126 190,104 C188,80 184,56 174,38 C166,24 144,18 128,18Z',
    cabin = 'M100,94 C104,82 116,76 128,76 C140,76 152,82 156,94 L158,148 C154,158 142,164 128,164 C114,164 102,158 98,148Z',
    windshield = 'M102,94 C106,82 116,76 128,76 C140,76 150,82 154,94 L156,108 C152,116 140,121 128,121 C116,121 104,116 100,108Z',
    rear_win   = 'M102,136 C106,126 116,120 128,120 C140,120 150,126 154,136 L156,148 C152,158 140,164 128,164 C116,164 104,158 100,148Z',
    panel = 'M174,38 C184,56 188,80 190,104 C192,126 192,146 190,162 C186,176 178,186 168,192 L178,202 C192,194 202,182 206,162 C210,142 210,118 208,94 C206,68 200,42 190,24Z',
    wheels=[(66,86),(190,86),(64,170),(192,170)], wr=26,
    hl=[(84,22),(168,22)], tl=[(86,192),(170,192)],
    door='M98,122 Q128,118 158,122',
    grille='M92,24 L164,24 L168,38 L88,38Z',
    hood_line=None,
),

'offroad': dict(
    # Wrangler: very boxy, tall, chunky tires, flat panels
    body  = 'M128,20 C112,20 90,26 84,40 C74,58 70,82 68,106 C66,128 66,150 70,168 C74,184 84,196 98,204 C108,210 118,214 128,214 C138,214 148,210 158,204 C172,196 182,184 186,168 C190,150 190,128 188,106 C186,82 182,58 172,40 C166,26 144,20 128,20Z',
    cabin = 'M98,96 C102,84 114,78 128,78 C142,78 154,84 158,96 L160,176 C156,186 143,192 128,192 C113,192 100,186 96,176Z',
    windshield = 'M100,96 C104,84 114,78 128,78 C142,78 152,84 156,96 L158,112 C154,120 142,126 128,126 C114,126 102,120 98,112Z',
    rear_win   = 'M98,160 C102,150 113,144 128,144 C143,144 154,150 158,160 L160,176 C156,186 143,192 128,192 C113,192 100,186 96,176Z',
    panel = 'M172,40 C182,58 186,82 188,106 C190,128 190,150 186,168 C182,184 172,196 158,204 L168,214 C186,204 198,190 202,168 C206,146 206,122 204,98 C202,72 196,46 184,28Z',
    wheels=[(66,88),(190,88),(62,178),(194,178)], wr=27,
    hl=[(86,24),(168,24)], tl=[(90,206),(166,206)],
    door='M96,128 Q128,124 160,128 M96,162 Q128,158 160,162',
    grille='M92,26 L164,26 L168,42 L88,42Z',
    hood_line=None,
),

}


# ── SVG generator ─────────────────────────────────────────────────────────────

def car_svg(name, paint_hex, shape_key, roof_hex=None, window_tint=None):
    P  = h2r(paint_hex)
    R  = h2r(roof_hex)  if roof_hex  else dk(P, 0.08)
    WT = h2r(window_tint) if window_tint else (80, 140, 200)

    HL  = lt(P, 0.55)     # specular highlight (very bright)
    HL2 = lt(P, 0.28)     # secondary highlight
    SH  = dk(P, 0.35)     # body shadow
    DS  = dk(P, 0.58)     # deep shadow (side panel)
    RS  = dk(R, 0.30)     # roof shadow

    gid = name.lower().replace(' ','').replace('-','').replace('/','').replace('.','')
    sh = SHAPES[shape_key]

    lines = []
    def w(s): lines.append(s)

    w(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">')
    w('<defs>')

    # Paint gradient — vertical (top=highlight, mid=base, bot=shadow)
    w(f'<linearGradient id="pg{gid}" x1="0" y1="0" x2="0" y2="1">')
    w(f'  <stop offset="0%"   stop-color="{cs(HL)}"/>')
    w(f'  <stop offset="15%"  stop-color="{cs(HL2)}"/>')
    w(f'  <stop offset="45%"  stop-color="{cs(P)}"/>')
    w(f'  <stop offset="78%"  stop-color="{cs(SH)}"/>')
    w(f'  <stop offset="100%" stop-color="{cs(dk(P,.52))}"/>')
    w(f'</linearGradient>')

    # Side panel gradient (horizontal, dark)
    w(f'<linearGradient id="sp{gid}" x1="0" y1="0" x2="1" y2="0">')
    w(f'  <stop offset="0%"   stop-color="{cs(DS)}"/>')
    w(f'  <stop offset="60%"  stop-color="{cs(dk(P,.72))}"/>')
    w(f'  <stop offset="100%" stop-color="{cs(dk(P,.80))}"/>')
    w(f'</linearGradient>')

    # Roof gradient
    w(f'<linearGradient id="rg{gid}" x1="0" y1="0" x2="0" y2="1">')
    w(f'  <stop offset="0%"   stop-color="{cs(lt(R,.2))}"/>')
    w(f'  <stop offset="40%"  stop-color="{cs(R)}"/>')
    w(f'  <stop offset="100%" stop-color="{cs(RS)}"/>')
    w(f'</linearGradient>')

    # Glass gradient (diagonal sky reflection)
    wt_lite = lt(WT, 0.55)
    wt_dark = dk(WT, 0.25)
    w(f'<linearGradient id="gl{gid}" x1="0" y1="0" x2="1" y2="1">')
    w(f'  <stop offset="0%"   stop-color="{cs(wt_lite, 0.82)}"/>')
    w(f'  <stop offset="50%"  stop-color="{cs(WT, 0.60)}"/>')
    w(f'  <stop offset="100%" stop-color="{cs(wt_dark, 0.72)}"/>')
    w(f'</linearGradient>')

    # Rim gradient
    w(f'<radialGradient id="wg{gid}" cx="40%" cy="35%" r="55%">')
    w(f'  <stop offset="0%"   stop-color="#c8c8cc"/>')
    w(f'  <stop offset="35%"  stop-color="#666"/>')
    w(f'  <stop offset="100%" stop-color="#111"/>')
    w(f'</radialGradient>')

    # Soft shadow filter
    w(f'<filter id="sf{gid}" x="-30%" y="-30%" width="160%" height="160%">')
    w(f'  <feGaussianBlur stdDeviation="8"/>')
    w(f'</filter>')

    w('</defs>')

    # ── Ground shadow ─────────────────────────────────────────────────────────
    # Cast shadow offset right-down
    w(f'<ellipse cx="140" cy="236" rx="108" ry="13" fill="rgba(0,0,0,0.30)" filter="url(#sf{gid})"/>')

    # ── Right side panel (3D face) ────────────────────────────────────────────
    if sh.get('panel'):
        w(f'<path d="{sh["panel"]}" fill="url(#sp{gid})"/>')

    # ── Main body (roof / top surface) ───────────────────────────────────────
    w(f'<path d="{sh["body"]}" fill="url(#pg{gid})"/>')

    # ── Hood highlight line ───────────────────────────────────────────────────
    if sh.get('hood_line'):
        w(f'<path d="{sh["hood_line"]}" stroke="{cs(HL)}" stroke-width="1.5" fill="none" opacity="0.45"/>')

    # ── Metallic specular streak across upper body ────────────────────────────
    # A bright diagonal streak on the roof/hood for metallic sheen
    w(f'<path d="{sh["body"]}" fill="none" stroke="{cs(HL)}" stroke-width="28" stroke-dasharray="40 200" stroke-dashoffset="60" opacity="0.12" stroke-linecap="round"/>')

    # ── Grille (front detail) ─────────────────────────────────────────────────
    if sh.get('grille'):
        grille_dark = dk(P, 0.60)
        w(f'<path d="{sh["grille"]}" fill="{cs(grille_dark)}" rx="2"/>')
        # grille horizontal slats
        gy_vals = [33, 37, 41] if shape_key != 'truck' else [27, 31, 35]
        for gy in gy_vals:
            w(f'<line x1="100" y1="{gy}" x2="156" y2="{gy}" stroke="{cs(dk(P,.45))}" stroke-width="1" opacity="0.7"/>')

    # ── Cabin / roof area ─────────────────────────────────────────────────────
    w(f'<path d="{sh["cabin"]}" fill="url(#rg{gid})"/>')

    # Roof panel: right-side extension (cabin 3D face, visible from above-right)
    # Simple offset of the cabin right edge
    w(f'<path d="{sh["cabin"]}" fill="{cs(dk(R,.48))}" transform="translate(12,4) scale(0.92,1)" opacity="0.85"/>')

    # Roof highlight strip
    w(f'<path d="{sh["cabin"]}" fill="{cs(lt(R,.45))}" opacity="0.22"/>')

    # ── Windshield ────────────────────────────────────────────────────────────
    w(f'<path d="{sh["windshield"]}" fill="url(#gl{gid})"/>')
    # Windshield reflection band
    w(f'<path d="{sh["windshield"]}" fill="{cs(lt(WT,.7), 0.18)}" transform="translate(0,2)"/>')

    # ── Rear window ───────────────────────────────────────────────────────────
    w(f'<path d="{sh["rear_win"]}" fill="url(#gl{gid})"/>')

    # ── Door lines ────────────────────────────────────────────────────────────
    if sh.get('door'):
        for dline in sh['door'].split(' M '):
            dpath = dline if dline.startswith('M') else 'M ' + dline
            w(f'<path d="{dpath}" stroke="{cs(dk(P,.28))}" stroke-width="1" fill="none" opacity="0.7"/>')

    # ── Headlights ────────────────────────────────────────────────────────────
    for (hx, hy) in sh['hl']:
        w(f'<rect x="{hx-14}" y="{hy}" width="28" height="7" rx="3" fill="#fffce0" opacity="0.96"/>')
        w(f'<rect x="{hx-12}" y="{hy+1}" width="24" height="3" rx="1" fill="#ffee88" opacity="0.5"/>')
        # DRL inner
        w(f'<rect x="{hx-9}"  y="{hy+2}" width="18" height="2" rx="1" fill="rgba(255,250,200,0.7)"/>')

    # ── Taillights ────────────────────────────────────────────────────────────
    for (tx, ty) in sh['tl']:
        w(f'<rect x="{tx-14}" y="{ty}" width="28" height="7" rx="3" fill="#cc1100" opacity="0.92"/>')
        w(f'<rect x="{tx-10}" y="{ty+1}" width="20" height="3" rx="1" fill="#ff2200" opacity="0.45"/>')

    # ── Wheels ────────────────────────────────────────────────────────────────
    wr = sh['wr']
    wi = int(wr * 0.60)  # hub radius
    rr = int(wr * 0.42)  # rim radius
    for (wx, wy) in sh['wheels']:
        # Tyre (slightly squashed)
        w(f'<ellipse cx="{wx}" cy="{wy}" rx="{wr}" ry="{int(wr*0.88)}" fill="#161616"/>')
        # Tyre edge highlight
        w(f'<ellipse cx="{wx-1}" cy="{wy-1}" rx="{wr-2}" ry="{int((wr-2)*0.88)}" fill="#2a2a2a" opacity="0.5"/>')
        # Hub
        w(f'<ellipse cx="{wx}" cy="{wy}" rx="{wi}" ry="{int(wi*0.88)}" fill="url(#wg{gid})"/>')
        # Rim ring
        w(f'<ellipse cx="{wx}" cy="{wy}" rx="{rr}" ry="{int(rr*0.88)}" fill="none" stroke="#b8b8be" stroke-width="2.2"/>')
        # 5 spokes
        for i in range(5):
            ang = math.radians(i*72 + 18)
            ex = wx + (rr-1)*math.cos(ang)
            ey = wy + (rr-1)*0.88*math.sin(ang)
            w(f'<line x1="{wx}" y1="{wy}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#aaaaae" stroke-width="2"/>')
        # Centre cap
        w(f'<circle cx="{wx}" cy="{wy}" r="4" fill="#d0d0d4"/>')
        w(f'<circle cx="{wx}" cy="{wy}" r="2" fill="#888"/>')
        # Brake disc hint
        w(f'<ellipse cx="{wx}" cy="{wy}" rx="{int(wi*0.55)}" ry="{int(wi*0.55*0.88)}" fill="#1e1e1e" opacity="0.7"/>')

    w('</svg>')
    return '\n'.join(lines)


# ── Car definitions ───────────────────────────────────────────────────────────

CARS = [
    # (filename,        display,              paint,     shape,      roof,      window_tint)
    ('ferrari488',    'Ferrari 488',        '#cc1200', 'supercar', None,       None),
    ('lambohuracan',  'Huracán',            '#d4a800', 'hypercar', '#1a1400',  None),
    ('mclaren720',    'McLaren 720S',       '#e04800', 'hypercar', '#181818',  None),
    ('bugattichiron', 'Bugatti Chiron',     '#021878', 'hypercar', '#101010',  '#60a8d8'),
    ('bmwm4',         'BMW M4',             '#1438a8', 'coupe',    '#0c2070',  '#80b0e0'),
    ('porsche911',    'Porsche 911',        '#e0e0e0', 'coupe',    '#c0c0c0',  '#a0c8e8'),
    ('amggt',         'AMG GT Black',       '#141414', 'coupe',    '#0a0a0a',  '#607090'),
    ('rangerover',    'Range Rover',        '#141414', 'suv',      '#0a0a0a',  '#607090'),
    ('gtrr35',        'Nissan GT-R',        '#c0c2cc', 'coupe',    '#909098',  '#8ab0c8'),
    ('challenger',    'Challenger',         '#111111', 'muscle',   '#080808',  '#507090'),
    ('mustanggt',     'Mustang GT500',      '#163818', 'muscle',   '#0c2410',  '#609070'),
    ('fordraptor',    'Ford Raptor',        '#c05800', 'truck',    '#883c00',  None),
    ('astondb11',     'Aston Martin DB11',  '#0e381a', 'coupe',    '#08220e',  '#60a870'),
    ('cybertruck',    'Cybertruck',         '#cacad2', 'truck',    '#aaabb4',  '#90c0d0'),
    ('wrangler',      'Wrangler',           '#3c5a1e', 'offroad',  '#28400e',  '#80a060'),
    ('bentleygtc',    'Bentley GTC',        '#1a0a00', 'coupe',    '#100600',  '#806040'),
    ('rollsroyce',    'Rolls-Royce',        '#f0ede8', 'sedan',    '#181816',  '#a0c0d0'),
    ('lambourus',     'Lambo Urus',         '#f0f0ee', 'suv',      '#d0d0cc',  '#a0b8c8'),
]

for fname, dname, paint, shape, roof, wtint in CARS:
    svg = car_svg(dname, paint, shape, roof, wtint)
    path = os.path.join(OUT, f'{fname}.svg')
    with open(path, 'w') as f:
        f.write(svg)
    print(f'✓ {path}')

print(f'\nGenerated {len(CARS)} cars → {OUT}')
