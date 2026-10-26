#!/usr/bin/env python3
"""Creature save states: the components a ported creature persists, in project coordinates."""
import math

# beefalo.lua periodicspawner:SetRandomTimes(40, 60): the saved time never exceeds the project's poop limit.
BEEFALO_POOP_MAX_SECONDS = 100
BEEFALO_BEARD_BITS = 3
WILD_DOMESTICATION = {'domestication_latch': False, 'tendencies': [], 'obedience': 0, 'minobedience': 0,
                      'domestication': 0, 'domesticated': False}
EMPTY_CLOTHING = {'clothing': {slot: '' for slot in ('beef_horn', 'beef_feet', 'beef_head', 'beef_tail', 'beef_body')}}


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def beefalo_components(data, context):
    # beefalo.lua OnSave (tendency, hascarrat) plus the component OnSaves. Only knownlocations, periodicspawner
    # and beard are ported. A wild, unhurt, unclothed beefalo's other components are validated and dropped:
    # health and hunger at their defaults, no domestication, ride or carrat, and no clothing. leader followers are
    # babybeefalo, which is not ported; uniqueid, brushable and an unnamed writeable are rebuilt.
    if set(data) - {'periodicspawner', 'tendency', 'hascarrat', 'carratcolor', 'leader', 'knownlocations', 'uniqueid',
                    'skinner_beefalo', 'brushable', 'domesticatable', 'health', 'hunger', 'beard', 'writeable'}:
        raise ValueError('Unsupported beefalo save state')
    if data.get('tendency', 'DEFAULT') != 'DEFAULT' or data.get('hascarrat', False) is not False \
            or data.get('carratcolor') is not None:
        raise ValueError('Unsupported beefalo tendency or carrat')
    domestication = {key: value for key, value in (data.get('domesticatable') or {}).items()
                     if key not in ('lastdomesticationgaindelta', 'rideable')}
    if domestication and domestication != WILD_DOMESTICATION:
        raise ValueError('Unsupported domesticated beefalo')
    if data.get('skinner_beefalo', EMPTY_CLOTHING) != EMPTY_CLOTHING:
        raise ValueError('Unsupported beefalo clothing')
    if data.get('health', {'health': 1000}) != {'health': 1000} or data.get('hunger', {'hunger': 0}) != {'hunger': 0}:
        raise ValueError('Unsupported beefalo health or hunger')
    writeable = data.get('writeable')
    if writeable is not None and (not isinstance(writeable, dict) or writeable.get('text')):
        raise ValueError('Unsupported named beefalo')
    leader = data.get('leader')
    if leader is not None and (not isinstance(leader, dict) or set(leader) - {'followers'}):
        raise ValueError('Unsupported beefalo leader state')

    locations = []
    for location in (data.get('knownlocations') or {}).get('locations', []):
        if not isinstance(location, dict) or set(location) != {'name', 'x', 'y', 'z'} \
                or not isinstance(location['name'], str) or not all(_finite(location[axis]) for axis in 'xyz'):
            raise ValueError('Unsupported beefalo known location')
        x, y, z = context['project']([location['x'], location['y'], location['z']])
        locations.append({'name': location['name'], 'x': x, 'y': y, 'z': z})
    if len({location['name'] for location in locations}) != len(locations):
        raise ValueError('Duplicate beefalo known location')
    herd = next((location for location in locations if location['name'] == 'herd'), None)

    spawner = data.get('periodicspawner') or {}
    if set(spawner) - {'time'} or not _finite(spawner.get('time', 0)) \
            or not 0 <= spawner.get('time', 0) <= BEEFALO_POOP_MAX_SECONDS:
        raise ValueError('Unsupported beefalo periodicspawner state')

    components = {
        'home': [herd['x'], herd['y'], herd['z']] if herd else context['position'],
        'knownlocations': {'locations': locations},
        # DST does not save the entity's rotation.
        'heading': 0,
        'poopRemainingSeconds': spawner.get('time', 0),
    }
    beard = data.get('beard')
    if beard is not None:
        if not isinstance(beard, dict) or set(beard) != {'growth', 'growthaccumulator', 'bits'} \
                or type(beard['growth']) is not int or not _finite(beard['growthaccumulator']) \
                or type(beard['bits']) is not int or not 0 <= beard['bits'] <= BEEFALO_BEARD_BITS:
            raise ValueError('Unsupported beefalo beard state')
        components['beard'] = dict(beard)
    return {'beefalo': components}
