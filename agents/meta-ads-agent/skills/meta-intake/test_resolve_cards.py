#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import resolve_cards


def product_field(value, options=None, name="📦 Product"):
    return {
        "name": name,
        "type": "drop_down",
        "value": value,
        "type_config": {
            "options": options or [
                {"id": "flower-id", "orderindex": 0, "name": "Real Flower"},
                {"id": "sleep-id", "orderindex": 1, "name": "Deep Sleep Gummies"},
            ]
        },
    }


def decoy_product_field(value=0):
    return product_field(
        value,
        options=[
            {"id": "no-id", "orderindex": 0, "name": "No (Empty Packaging Only)"},
            {"id": "yes-id", "orderindex": 1, "name": "Yes (Sampled Products Sent)"},
        ],
        name="🍃 Creator Sampled Products?",
    )


def task(name="Fallback Flower Card", text="", custom_fields=None):
    return {
        "name": name,
        "text_content": text,
        "description": "",
        "custom_fields": custom_fields or [],
        "status": {"status": "ready"},
    }


class ResolveProductFieldTests(unittest.TestCase):
    def test_authoritative_real_flower_resolves_flower(self):
        self.assertEqual(resolve_cards.resolve_product_field([product_field(0)]), "Flower")

    def test_authoritative_deep_sleep_gummies_resolves_sleep_gummies(self):
        self.assertEqual(resolve_cards.resolve_product_field([product_field("sleep-id")]), "Sleep Gummies")

    def test_decoy_before_real_still_resolves_real_product(self):
        fields = [decoy_product_field(0), product_field(0)]
        self.assertEqual(resolve_cards.resolve_product_field(fields), "Flower")

    def test_unset_product_field_returns_empty_for_fallback(self):
        self.assertEqual(resolve_cards.resolve_product_field([product_field(None)]), "")

    def test_unrecognized_product_option_returns_empty_for_fallback(self):
        field = product_field(
            0,
            options=[{"id": "other-id", "orderindex": 0, "name": "Accessories"}],
        )
        self.assertEqual(resolve_cards.resolve_product_field([field]), "")

    def test_absent_product_field_returns_empty(self):
        fields = [{"name": "Brief Writer", "type": "users", "value": []}]
        self.assertEqual(resolve_cards.resolve_product_field(fields), "")

    def test_two_recognized_products_disagree_returns_empty(self):
        fields = [product_field(0), product_field(1, name="Backup Product")]
        self.assertEqual(resolve_cards.resolve_product_field(fields), "")

    def test_only_decoy_returns_empty_for_fallback(self):
        self.assertEqual(resolve_cards.resolve_product_field([decoy_product_field(1)]), "")

    def test_resolve_falls_back_to_heuristic_when_field_absent(self):
        with patch.object(resolve_cards, "get_task", return_value=task(name="Deep Sleep Gummies card")):
            self.assertEqual(resolve_cards.resolve("card-a")["product"], "Sleep Gummies")

    def test_resolve_falls_back_to_heuristic_when_field_unset(self):
        with patch.object(resolve_cards, "get_task", return_value=task(
            name="Fallback Flower Card",
            custom_fields=[product_field(None)],
        )):
            self.assertEqual(resolve_cards.resolve("card-a")["product"], "Flower")

    def test_resolve_falls_back_to_heuristic_when_field_unrecognized(self):
        field = product_field(0, options=[{"id": "other-id", "orderindex": 0, "name": "Accessories"}])
        with patch.object(resolve_cards, "get_task", return_value=task(
            text="PRODUCT: Flower",
            custom_fields=[field],
        )):
            self.assertEqual(resolve_cards.resolve("card-a")["product"], "Flower")

    def test_resolve_falls_back_to_heuristic_when_only_decoy_present(self):
        with patch.object(resolve_cards, "get_task", return_value=task(
            name="Deep Sleep Gummies Card",
            custom_fields=[decoy_product_field()],
        )):
            self.assertEqual(resolve_cards.resolve("card-a")["product"], "Sleep Gummies")

    def test_resolve_falls_back_to_heuristic_when_recognized_fields_disagree(self):
        fields = [product_field(0), product_field(1, name="Backup Product")]
        with patch.object(resolve_cards, "get_task", return_value=task(
            name="Fallback Flower Card",
            custom_fields=fields,
        )):
            self.assertEqual(resolve_cards.resolve("card-a")["product"], "Flower")


if __name__ == "__main__":
    unittest.main()
