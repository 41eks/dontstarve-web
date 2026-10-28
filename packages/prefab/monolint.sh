#!/bin/sh

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1

rg -F -q 'THREE.Group' "$script_dir/src"

rg -F -q 'model.userData' "$script_dir/src"
case $? in
  0)
    printf 'Error: packages/prefab/src contains THREE.Group\n' >&2
    exit 1
    ;;
  1) exit 0 ;;
  *)
    printf 'Error: could not search packages/prefab/src\n' >&2
    exit 2
    ;;
esac


# 反面案例
# -/** The concrete model created and owned by a display. */
# -export type DisplayModel = THREE.Group;