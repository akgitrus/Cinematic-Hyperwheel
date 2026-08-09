# generalized_hsl.py

from __future__ import annotations

from dataclasses import dataclass
from math import atan2, sqrt
from typing import Mapping


# ---------------------------------------------------------------------------
# Base channels
# ---------------------------------------------------------------------------

# Порядок каналов является частью определения системы координат.
# Для RGB это:
#
#   R -> G -> B
#
# Для эксперимента с tag_genome сюда будут помещены 1000 тегов
# в фиксированном порядке.

BASE_CHANNELS: tuple[str, ...] = (
    "R",
    "G",
    "B",
)


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HSL:
    """
    Generalized HSL representation.

    H:
        X - 2 hyperspherical angles, in radians.

    S:
        Saturation, scalar in [0, 1].

    L:
        Lightness, scalar in [0, 1].
    """

    H: tuple[float, ...]
    S: float
    L: float


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_channels(
    channels: Mapping[str, float],
    base_channels: tuple[str, ...],
) -> None:
    expected = set(base_channels)
    actual = set(channels)

    missing = expected - actual
    extra = actual - expected

    if missing:
        raise ValueError(f"Missing channels: {sorted(missing)}")

    if extra:
        raise ValueError(f"Unknown channels: {sorted(extra)}")

    for name in base_channels:
        value = channels[name]

        if not 0.0 <= value <= 1.0:
            raise ValueError(
                f"Channel {name!r} has value {value!r}; "
                "normalized values must be in [0, 1]"
            )


# ---------------------------------------------------------------------------
# Generalized RGB -> HSL
# ---------------------------------------------------------------------------

def to_hsl(
    channels: Mapping[str, float],
    base_channels: tuple[str, ...] = BASE_CHANNELS,
) -> HSL:
    """
    Convert X normalized channels to generalized HSL.

    Parameters
    ----------
    channels:
        Mapping:
            channel_name -> normalized value in [0, 1]

        Example:
            {
                "R": 1.0,
                "G": 0.5,
                "B": 0.0,
            }

    base_channels:
        Ordered sequence defining the coordinate system.

    Returns
    -------
    HSL
        H contains X-2 hyperspherical angles.
        S and L are scalars.

    Notes
    -----
    For X channels:

        X input values
        X-1 dimensional chromatic space
        X-2 angular coordinates

    Therefore:

        RGB (X=3) -> 1 H angle
        1000 channels -> 998 H angles
    """

    x = len(base_channels)

    if x < 3:
        raise ValueError(
            "At least 3 channels are required."
        )

    _validate_channels(channels, base_channels)

    # Keep the explicitly defined channel order.
    values = tuple(channels[name] for name in base_channels)

    # -----------------------------------------------------------------------
    # 1. Cmax, Cmin, Delta
    # -----------------------------------------------------------------------

    c_max = max(values)
    c_min = min(values)
    delta = c_max - c_min

    # -----------------------------------------------------------------------
    # 2. Lightness
    # -----------------------------------------------------------------------

    L = (c_max + c_min) / 2.0

    # -----------------------------------------------------------------------
    # 3. Saturation
    # -----------------------------------------------------------------------

    if delta == 0.0:
        S = 0.0
    else:
        denominator = 1.0 - abs(2.0 * L - 1.0)

        # denominator can theoretically become zero only at
        # the degenerate endpoints.
        if denominator == 0.0:
            S = 0.0
        else:
            S = delta / denominator

    # -----------------------------------------------------------------------
    # 4. Chromatic component
    #
    # Remove the neutral component (the mean).
    #
    # q_i = x_i - mean(x)
    #
    # Therefore:
    #
    # sum(q_i) = 0
    #
    # and the vector belongs to an X-1 dimensional hyperplane.
    # -----------------------------------------------------------------------

    mean = sum(values) / x

    q = tuple(value - mean for value in values)

    # -----------------------------------------------------------------------
    # 5. Convert the X-1 dimensional chromatic vector into explicit
    #    coordinates.
    #
    # We can drop the final coordinate because:
    #
    # q_1 + q_2 + ... + q_X = 0
    #
    # Therefore q_X can be reconstructed from the first X-1 coordinates.
    #
    # IMPORTANT:
    # This is a coordinate representation of the chromatic hyperplane.
    # For a mathematically exact Euclidean representation of a regular
    # simplex, an orthonormal simplex basis should eventually be used.
    # -----------------------------------------------------------------------

    y = q[:-1]

    # -----------------------------------------------------------------------
    # 6. Hyperspherical coordinates
    #
    # A vector in R^(X-1) requires X-2 angles to describe its direction.
    #
    # For example:
    #
    # X = 3:
    #     y = (y1, y2)
    #     H = (atan2(y2, y1),)
    #
    # X = 4:
    #     y = (y1, y2, y3)
    #     H = (
    #         angle_1,
    #         angle_2,
    #     )
    #
    # etc.
    # -----------------------------------------------------------------------

    magnitude = sqrt(sum(value * value for value in y))

    if magnitude == 0.0:
        # Completely neutral point.
        #
        # Hue is undefined, just as hue is undefined for:
        #
        #   R = G = B
        #
        # We return zeros as a deterministic representation.
        H = (0.0,) * (x - 2)

    else:
        angles: list[float] = []

        # For n = X-1 dimensional vector:
        #
        # angle_i =
        #     atan2(
        #         sqrt(y_(i+1)^2 + ... + y_n^2),
        #         y_i
        #     )
        #
        # There are n-1 = X-2 angles.

        n = len(y)

        for i in range(n - 1):
            remaining = y[i + 1:]

            radius = sqrt(
                sum(value * value for value in remaining)
            )

            angle = atan2(radius, y[i])

            angles.append(angle)

        # Final angular coordinate describes orientation in the
        # final 2D plane.
        final_angle = atan2(y[-1], y[-2])
        angles[-1] = final_angle

        H = tuple(angles)

    return HSL(
        H=H,
        S=S,
        L=L,
    )