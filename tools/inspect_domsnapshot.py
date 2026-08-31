#!/usr/bin/env python3
"""Print DOMSnapshot nodes/ancestors and layout bounds for matching text."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("text")
    parser.add_argument("--subtree", type=int)
    args = parser.parse_args()
    payload = json.loads(args.snapshot.read_text(encoding="utf-8"))
    strings: list[str] = payload["strings"]
    document = payload["documents"][0]
    nodes = document["nodes"]
    layout = document["layout"]
    layout_by_node = {
        node_index: layout["bounds"][index]
        for index, node_index in enumerate(layout["nodeIndex"])
    }

    def string_at(index: int) -> str:
        return strings[index] if index >= 0 else ""

    def attrs_at(node_index: int) -> dict[str, str]:
        raw = nodes["attributes"][node_index]
        return {
            string_at(raw[index]): string_at(raw[index + 1])
            for index in range(0, len(raw), 2)
        }

    matches = []
    for node_index, value_index in enumerate(nodes["nodeValue"]):
        value = string_at(value_index)
        attributes = attrs_at(node_index)
        matching_attribute = next(
            (f"{key}={attribute}" for key, attribute in attributes.items() if args.text in key or args.text in attribute),
            "",
        )
        if args.text in value or matching_attribute:
            matches.append((node_index, value or matching_attribute))

    if args.subtree is not None:
        wanted = args.subtree
        for candidate in range(len(nodes["parentIndex"])):
            lineage = []
            current = candidate
            while current >= 0:
                lineage.append(current)
                if current == wanted:
                    name = string_at(nodes["nodeName"][candidate])
                    value = string_at(nodes["nodeValue"][candidate])
                    print(f"node={candidate} parent={nodes['parentIndex'][candidate]} name={name} value={value!r} bounds={layout_by_node.get(candidate)} attrs={attrs_at(candidate)}")
                    break
                current = nodes["parentIndex"][current]
        return

    for match_index, (node_index, value) in enumerate(matches, 1):
        print(f"\nMATCH {match_index}: node={node_index} value={value!r}")
        current = node_index
        depth = 0
        while current >= 0 and depth < 12:
            name = string_at(nodes["nodeName"][current])
            attrs = attrs_at(current)
            useful = {key: attrs[key] for key in ("class", "role", "data-state", "aria-label") if key in attrs}
            print(f"  {depth}: node={current} name={name} bounds={layout_by_node.get(current)} attrs={useful}")
            current = nodes["parentIndex"][current]
            depth += 1


if __name__ == "__main__":
    main()
