#!/usr/bin/env python3
"""DST world_network persist state -> the project's clock, season, temperature and weather systems.

`world_network_fn` saves the shard's non-entity components. The project keeps the subset its save schema declares
(src/save/types.ts `world.systems`); fields for features it has not ported are validated, then dropped.
"""
import math

SEASONS = ('autumn', 'winter', 'spring', 'summer')
CLOCK_PHASES = ('day', 'dusk', 'night')
SEASON_MODES = ('cycle', 'endless', 'always')
NIGHTMARE_PHASES = ('calm', 'warn', 'wild', 'dawn')
PRECIPITATION_TYPES = ('none', 'rain', 'snow')

# src/tuning.ts TUNING: SEG_TIME 30 and the fixed 10 / 4 / 2 day, dusk and night segments. seasons.lua gives each
# season its own 16 segments, which the project does not port yet: the import keeps the source phase and its progress
# inside the project's phase length, so the same day and phase resume.
SEG_TIME = 30
PHASE_SEGS = {'day': 10, 'dusk': 4, 'night': 2}
TOTAL_DAY_TIME = sum(PHASE_SEGS.values()) * SEG_TIME
PHASE_START = {'day': 0, 'dusk': PHASE_SEGS['day'] * SEG_TIME,
               'night': (PHASE_SEGS['day'] + PHASE_SEGS['dusk']) * SEG_TIME}
NUM_CLOCK_SEGS = 16
# src/tuning.ts MOON_PHASE_CYCLES: clock.lua's 20-step moon cycle.
MOON_PHASE_CYCLES = 20


def number(value, name, minimum=None, maximum=None):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f'Unsupported {name}')
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise ValueError(f'Unsupported {name}')
    return value


def integer(value, name, minimum=None, maximum=None):
    if type(value) is not int:
        raise ValueError(f'Unsupported {name}')
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise ValueError(f'Unsupported {name}')
    return value


def choice(value, name, choices):
    if value not in choices:
        raise ValueError(f'Unsupported {name}')
    return value


def fields(data, name, allowed):
    if not isinstance(data, dict) or set(data) - allowed:
        raise ValueError(f'Unsupported {name} state')
    return data


def convert_clock(data):
    """clock.lua OnSave -> systems.clock / systems.moon, and the elapsed seconds carrying its cycles and phase."""
    data = fields(data, 'clock', {'cycles', 'phase', 'mooomphasecycle', 'totaltimeinphase', 'remainingtimeinphase', 'segs',
                                  'dsa_clocksync_moonphaselocked', 'dsa_clock_is_cave', 'dsa_extradata'})
    # The shared-clock mod's fields do not change the clock state this project restores.
    for key in ('dsa_clocksync_moonphaselocked', 'dsa_clock_is_cave'):
        if key in data and type(data[key]) is not bool:
            raise ValueError(f'Unsupported clock {key}')
    if 'dsa_extradata' in data and not isinstance(data['dsa_extradata'], dict):
        raise ValueError('Unsupported clock dsa_extradata')
    cycles = integer(data.get('cycles'), 'clock cycles', minimum=0)
    phase = choice(data.get('phase'), 'clock phase', CLOCK_PHASES)
    total = number(data.get('totaltimeinphase'), 'clock total time', minimum=0)
    remaining = number(data.get('remainingtimeinphase'), 'clock remaining time', minimum=0)
    if remaining > total:
        raise ValueError('Unsupported clock remaining time')
    segs = data.get('segs')
    if segs is not None:
        segs = fields(segs, 'clock segments', set(CLOCK_PHASES))
        values = [integer(segs.get(name), f'clock {name} segments', minimum=0) for name in CLOCK_PHASES]
        if sum(values) != NUM_CLOCK_SEGS:
            raise ValueError('Unsupported clock segments')
    progress = 0 if total == 0 else min(max(1 - remaining / total, 0), 1)
    elapsed = cycles * TOTAL_DAY_TIME + PHASE_START[phase] + progress * PHASE_SEGS[phase] * SEG_TIME
    moon = data.get('mooomphasecycle')
    # clock.lua retrofit: a save without mooomphasecycle derives it from its cycle count.
    moon = cycles % MOON_PHASE_CYCLES + 1 if moon is None else integer(
        moon, 'clock moon phase cycle', minimum=1, maximum=MOON_PHASE_CYCLES)
    return ({'day': cycles + 1, 'phase': phase, 'phaseProgress': progress}, {'mooomphasecycle': moon}, elapsed)


def convert_season(data):
    """seasons.lua OnSave -> systems.season; the calendar's modes and segments are not ported."""
    data = fields(data, 'seasons', {'mode', 'premode', 'israndom', 'segs', 'season', 'totaldaysinseason',
                                    'elapseddaysinseason', 'remainingdaysinseason', 'lengths'})
    season = choice(data.get('season'), 'season name', SEASONS)
    remaining = number(data.get('remainingdaysinseason'), 'season remaining days', minimum=0)
    if 'mode' in data:
        choice(data['mode'], 'season mode', SEASON_MODES)
    if 'premode' in data and type(data['premode']) is not bool:
        raise ValueError('Unsupported season premode')
    israndom = data.get('israndom')
    if israndom is not None:
        israndom = fields(israndom, 'season israndom', set(SEASONS))
        if any(type(value) is not bool for value in israndom.values()):
            raise ValueError('Unsupported season israndom')
        if any(israndom.values()):
            # seasons.lua randomises the calendar; the project has no seasons component to advance it.
            raise ValueError('Random seasons are not ported')
    for key in ('totaldaysinseason', 'elapseddaysinseason'):
        if key in data:
            number(data[key], f'season {key}', minimum=0)
    segs = data.get('segs')
    if segs is not None:
        segs = fields(segs, 'season segments', set(SEASONS))
        for name in SEASONS:
            phase_segs = fields(segs.get(name), f'{name} season segments', set(CLOCK_PHASES))
            if sum(integer(phase_segs.get(phase), f'{name} {phase} segments', minimum=0)
                   for phase in CLOCK_PHASES) != NUM_CLOCK_SEGS:
                raise ValueError(f'Unsupported {name} season segments')
    lengths = data.get('lengths')
    if lengths is not None:
        lengths = fields(lengths, 'season lengths', set(SEASONS))
        for name in SEASONS:
            number(lengths.get(name), f'{name} season length', minimum=1)
    return {'name': season, 'daysRemaining': remaining}


def convert_worldtemperature(data):
    """worldtemperature.lua OnSave -> systems.worldtemperature."""
    data = fields(data, 'worldtemperature', {'daylight', 'season', 'seasontemperature', 'phasetemperature', 'noisetime'})
    season = choice(data.get('season'), 'worldtemperature season', SEASONS)
    # Lua writes daylight only when it is true.
    if 'daylight' in data and data['daylight'] is not True:
        raise ValueError('Unsupported worldtemperature daylight')
    return {'season': season,
            'seasontemperature': number(data.get('seasontemperature'), 'worldtemperature seasontemperature'),
            'phasetemperature': number(data.get('phasetemperature'), 'worldtemperature phasetemperature'),
            'noisetime': number(data.get('noisetime'), 'worldtemperature noisetime', minimum=0),
            **({'daylight': True} if data.get('daylight') is True else {})}


def convert_weather(data):
    """weather.lua / cave_weather.lua OnSave -> systems.weather."""
    data = fields(data, 'weather', {
        'temperature', 'daylight', 'season', 'noisetime', 'moisturerateval', 'moisturerateoffset',
        'moistureratemultiplier', 'moisturerate', 'moisture', 'moisturefloor', 'moistureceilmultiplier',
        'moisturefloormultiplier', 'moistureceil', 'precipmode', 'preciptype', 'peakprecipitationrate',
        'snowlevel', 'lunarhaillevel', 'snowcovered', 'startsnowthreshold', 'stopsnowthreshold', 'lightningmode',
        'minlightningdelay', 'maxlightningdelay', 'nextlightningtime', 'wetness', 'wet'})
    result = {
        'moisture': number(data.get('moisture'), 'weather moisture', minimum=0),
        'moisturefloor': number(data.get('moisturefloor'), 'weather moisturefloor', minimum=0),
        'moistureceil': number(data.get('moistureceil'), 'weather moistureceil', minimum=0),
        'preciptype': choice(data.get('preciptype'), 'weather preciptype', PRECIPITATION_TYPES),
        'peakprecipitationrate': number(data.get('peakprecipitationrate'), 'weather peakprecipitationrate',
                                        minimum=0, maximum=1),
    }
    if 'snowlevel' in data:
        result['snowlevel'] = number(data['snowlevel'], 'weather snowlevel', minimum=0, maximum=1)
    # The rest belongs to unported precipitation modes, lightning, lunar hail, wetness and snow thresholds.
    for key in ('temperature', 'noisetime', 'moisturerateval', 'moisturerateoffset', 'moistureratemultiplier',
                'moisturerate', 'moistureceilmultiplier', 'moisturefloormultiplier', 'lunarhaillevel', 'wetness',
                'startsnowthreshold', 'stopsnowthreshold', 'nextlightningtime', 'minlightningdelay',
                'maxlightningdelay'):
        if key in data:
            number(data[key], f'weather {key}')
    for key in ('daylight', 'snowcovered', 'wet'):
        if key in data and type(data[key]) is not bool:
            raise ValueError(f'Unsupported weather {key}')
    for key in ('season',):
        if key in data:
            choice(data[key], f'weather {key}', SEASONS)
    for key in ('precipmode', 'lightningmode'):
        if key in data and type(data[key]) is not str:
            raise ValueError(f'Unsupported weather {key}')
    return result


def convert_nightmareclock(data):
    """nightmareclock.lua OnSave -> systems.nightmareclock."""
    data = fields(data, 'nightmareclock', {'lengths', 'phase', 'totaltimeinphase', 'remainingtimeinphase'})
    lengths = fields(data.get('lengths'), 'nightmareclock lengths', set(NIGHTMARE_PHASES))
    total = number(data.get('totaltimeinphase'), 'nightmareclock total time', minimum=0)
    remaining = number(data.get('remainingtimeinphase'), 'nightmareclock remaining time', minimum=0)
    if remaining > total:
        raise ValueError('Unsupported nightmareclock remaining time')
    return {'lengths': {name: integer(lengths.get(name), f'nightmareclock {name} length', minimum=0, maximum=63)
                        for name in NIGHTMARE_PHASES},
            'phase': choice(data.get('phase'), 'nightmareclock phase', NIGHTMARE_PHASES),
            'totaltimeinphase': total,
            'remainingtimeinphase': remaining}


def convert_systems(persistdata, prefab):
    """world_network_fn's persistdata -> (world.systems, world.elapsedSeconds, provenance)."""
    # An empty Lua table reads as []: a snapshot may save no world_network state.
    if persistdata == []:
        persistdata = {}
    if not isinstance(persistdata, dict):
        raise ValueError('Expected world_network persist data')
    known = {'clock', 'seasons', 'worldtemperature', 'weather', 'caveweather', 'nightmareclock',
             'fumarolelocaltemperature', 'quaker'}
    if set(persistdata) - known:
        raise ValueError(f'Unsupported world_network state: {sorted(set(persistdata) - known)}')
    systems, report, elapsed = {}, {}, 0
    clock = persistdata.get('clock')
    if clock is not None:
        systems['clock'], systems['moon'], elapsed = convert_clock(clock)
        report['clock'] = {key: clock[key] for key in ('cycles', 'phase', 'totaltimeinphase', 'remainingtimeinphase',
                                                       'segs') if key in clock}
        report['moonphasecycle'] = systems['moon']['mooomphasecycle']
    seasons = persistdata.get('seasons')
    if seasons is not None:
        systems['season'] = convert_season(seasons)
        report['season'] = {'name': systems['season']['name'],
                            'remainingDays': systems['season']['daysRemaining']}
    temperature = persistdata.get('worldtemperature')
    if temperature is not None:
        systems['worldtemperature'] = convert_worldtemperature(temperature)
        report['worldtemperature'] = dict(systems['worldtemperature'])
    weather, cave_weather = persistdata.get('weather'), persistdata.get('caveweather')
    if weather is not None and cave_weather is not None:
        raise ValueError('A world saves both weather and caveweather')
    if weather is not None or cave_weather is not None:
        systems['weather'] = convert_weather(weather if weather is not None else cave_weather)
        report['weather'] = dict(systems['weather'])
    nightmare = persistdata.get('nightmareclock')
    if nightmare is not None:
        if prefab != 'cave':
            # cave_network.lua adds the component; a forest world has no nightmare phase to restore.
            raise ValueError('A forest world cannot save a nightmareclock')
        systems['nightmareclock'] = convert_nightmareclock(nightmare)
        report['nightmareclock'] = dict(systems['nightmareclock'])
    # fumarolelocaltemperature and quaker are cave-only components the project has not ported: dropped.
    report['elapsedSeconds'] = elapsed
    return systems, elapsed, report
