# Hue-Based Movie Recommendation: Mathematics and Rationale

## 1. Problem

Given a category of movies, where each movie is described by values across **N criteria** (0..1), and where the criteria themselves have no notion of direction such as "better/worse" (just as no RGB channel is inherently "better" than another), we want to take a reference movie and find real movies "inspired by" it, following the principles of classical color schemes (complementary, triadic, analogous, etc.).

The goal is to preserve the overall character of the reference while deliberately shifting its "hue".

## 2. Analogy with HSL

| HSL (color, 3 channels)                     | This approach (N criteria)                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| L = mean of R, G, B for a single pixel      | L = mean of the criteria for a single movie                                           |
| Hue = angle in a fixed 120° basis (R, G, B) | Hue = direction in a data-driven plane (PCA)                                          |
| S = saturation                              | S = degree of "shape" expression (the norm of the deviation from the typical profile) |

The key difference from classical HSL is that the basis for hue in HSL is fixed by the physiology of human vision (R, G, B are equally spaced around the circle). Arbitrary criteria have no such physically meaningful basis — it must be **extracted from the data**, rather than postulated from the column order.

## 3. Building the Basis

For a movie `c` (a vector of length N):

1. **L (lightness)** — the movie's own mean across all criteria:
   `L = mean(c)`

2. **Q (shape)** — deviation from the movie's own mean:
   `Q = c - L`
   (the components of Q always sum to zero, so Q lies in a hyperplane perpendicular to `(1,...,1)`, directly analogous to the chromatic plane in HSL)

3. **M (typical profile)** — the mean of Q **across all movies** in the category (critical!):
   `M = mean(Q across all movies)`
   Without this step, PCA captures the structure common to all movies as the "main difference", rather than the actual variation between movies
   (a bug discovered and fixed during development — see Section 6).

4. **Standardization** — criteria are divided by their std (after subtracting M), so that criteria with greater random variation do not dominate PCA simply because of scale rather than genuine correlation with other criteria.

5. **PCA / SVD** on the normalized shape vectors of all movies → an orthonormal basis U (the principal axes of actual differences within the category), together with the explained-variance ratio for each component.

## 4. Choosing the Hue Plane

Not all components are equally suitable for rotation. In practice, some components may turn out to represent a general "quality" axis (the halo effect: good movies tend to be praised across many criteria simultaneously, while bad movies tend to be criticized across many criteria), rather than an axis of taste or character.

Rotating along such an axis produces a movie that is not "different in spirit", but objectively better or worse — which contradicts the purpose of the method.

**Solution:** components used for rotation are selected explicitly (`--hue-components`), after manual inspection using `diagnose` (criterion weights + lists of movies at each pole, showing what the component actually represents).

Non-rotating components are not discarded completely — they are kept close to the reference through the delta mechanism described in Section 5.

## 5. Rotation and Reconstruction

For a selected pair of components `(i, j)`:

1. **Whitening** — normalize each axis by its actual std across movies (otherwise, when the explained-variance shares of the components are strongly asymmetric, a 90–120° rotation in raw coordinates can move the target into a region containing almost no real movies).

2. **Rotation** by the scheme angle (180° for complementary, ±120° for triadic, ±30° for analogous, etc.) in whitened coordinates.

3. **Delta, not reconstruction** — only the change introduced by the rotation in the selected plane is added to the reference vector; everything else (including non-rotating components) remains as in the reference.

4. The target vector almost never corresponds exactly to a real movie. The final step is therefore to find the nearest real movie (nearest neighbor) to the target.

## 6. What Changed Compared to the Original Code

The original implementation (`to_hsl` + `_simplex_coordinates` + `_hyperspherical_angles`) was mathematically correct as an independent construction (numerically verified for basis orthonormality, isometry, and agreement with classical HSL on RGB), but it was not suitable for this particular problem:

| Original                                                       | Current                                                               | Why                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basis fixed by the order of `base_channels`                    | Basis extracted from the data (PCA)                                   | With 100+ criteria, there is no physically meaningful cyclic order comparable to R, G, B — a fixed order made the result dependent on arbitrary criterion numbering                                                                      |
| Hue = hyperspherical angles (nested; not all are full circles) | Hue = 2D plane with genuine angular rotation                          | Color schemes (complementary/triadic/...) require a true circle (S¹); hyperspherical polar angles (except the final one) are not cyclic, so a "180° rotation" is not properly defined for them                                           |
| S, L computed using max/min across criteria                    | S, L computed using the mean (L) and the norm of the shape vector (S) | A strictly invertible transformation (forward → rotate → inverse) was required without loss of precision; the max/min formula is not suitable for this                                                                                   |
| No criterion standardization                                   | Z-score standardization of criteria before PCA                        | Without standardization, criteria with greater variance artificially dominate regardless of their actual correlations                                                                                                                    |
| —                                                              | Double centering (L + M)                                              | Without subtracting the mean profile across the entire category (M), the first PCA component captures the shape common to all movies rather than differences between movies (a bug found on real data: all PC1 values had the same sign) |
| —                                                              | Whitening before rotation                                             | When explained-variance shares between components are strongly unequal (e.g. 50% vs. 7%), rotating by a fixed angle in raw coordinates can move the target into a region containing almost no real movies                                |
| —                                                              | Explicit hue-component selection (`--hue-components`)                 | Not all components are suitable for rotation — some represent general quality rather than taste; the axes to rotate must be selected deliberately                                                                                        |
| No inverse transformation                                      | Delta reconstruction + nearest-neighbor search                        | The goal is not an abstract vector, but a concrete movie from the catalog                                                                                                                                                                |

## 7. Known Limitations / Open Questions

* Rotation currently operates strictly in a single 2D plane (`--hue-components` accepts exactly 2 indices). For scenarios where taste is effectively multidimensional (>2 significant axes), a separate approach is needed for applying the scheme across multiple planes simultaneously.
* Hue-component selection is currently manual, based on visual inspection with `diagnose`. Automatic detection of "quality axes" (for example, by correlating a component with an independent rating/score, if such data is available) could eliminate this manual step.
* The PCA basis is estimated across the entire category at once. If explicit differences in criterion importance emerge in the future (not merely different scale, but different physical meaning/weight), a separate weighting scheme will be required.
