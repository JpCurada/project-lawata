import numpy as np

from lawata.imagery.service import local_cloud_frac


def _scl(values: list[int]) -> np.ndarray:
    return np.array(values, np.uint8).reshape(1, -1)


def test_cloud_fraction_counts_cloud_classes_over_valid_pixels() -> None:
    # water, water, cirrus, cloud-high -> half cloud
    assert local_cloud_frac(_scl([6, 6, 10, 9])) == 0.5


def test_nodata_is_left_out_of_the_denominator() -> None:
    # 4 valid pixels (1 shadow) and 2 nodata
    assert local_cloud_frac(_scl([6, 6, 6, 3, 0, 0]), min_valid_frac=0.5) == 0.25


def test_too_few_valid_pixels_gives_no_answer() -> None:
    assert local_cloud_frac(_scl([6, 0, 0, 0])) is None
    assert local_cloud_frac(_scl([0, 0])) is None
