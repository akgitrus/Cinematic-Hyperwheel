# Cinematic-Hyperwheel

Experimental high-dimensional generalization of the RGB → HSL color model for representing cinematic characteristics and exploring **harmony beyond similarity**.

## Goal

Cinematic-Hyperwheel is a prototype for testing the hypothesis that the principles behind harmonious color combinations on a color wheel can be applied to movie recommendations.

A color wheel allows us to find colors that are different from a given color while remaining harmonious with it. The project explores whether the same principle can be used to find movies that are **different from a given film, yet meaningfully "resonate" with it**.

The focus is therefore not similarity, but **harmony beyond similarity**.

## Concept

A conventional RGB color model can be viewed geometrically as a 2-dimensional simplex — a triangle with three vertices:

```text
        R
       / \
      /   \
     /     \
    G───────B
```

Every vertex is directly connected to every other vertex.

The same principle generalizes to an arbitrary number of dimensions.

An (N)-dimensional simplex has (N+1) vertices, with every vertex connected to every other vertex.

Therefore:

| Space | Vertices |   Edges |
| ----: | -------: | ------: |
|    1D |        2 |       1 |
|    2D |        3 |       3 |
|    3D |        4 |       6 |
|  999D |     1000 | 499,500 |

Cinematic-Hyperwheel explores the idea of treating approximately 1000 semantic movie characteristics as the vertices of such a high-dimensional system.

The ordered vertices form a conceptual **hyperwheel**: a cyclically ordered set of fundamental cinematic dimensions.

---

## From RGB to X channels

The conventional RGB → HSL transformation can be viewed as:

```text
3 channels
    ↓
2-dimensional simplex
    ↓
1 angular coordinate
    ↓
H + S + L
```

For `X` channels, the proposed generalization is:

```text
X channels
    ↓
(X - 1)-dimensional simplex
    ↓
(X - 2) angular coordinates
    ↓
H + S + L
```

Thus:

[
X \rightarrow (X-2) + 1 + 1
]

The representation preserves the total number of independent dimensions.

For 1000 channels:

[
1000 \rightarrow 998H + S + L
]

---

## Cinematic representation

The project uses the **Tag Genome Dataset** as the source of the movie representations. Each movie is described by its relevance to a common set of 1,128 semantic tags.

Each movie contains approximately 1000 tag relevance values:

```text
movieId, tag, relevance

1, autism, 0.048
1, aviation, 0.0195
1, awesome, 0.3835
...
```

Each tag is treated as a normalized channel:

```text
tag₁       → channel₁
tag₂       → channel₂
...
tag₁₀₀₀   → channel₁₀₀₀
```

The `relevance` value becomes the normalized channel value.

A movie is therefore represented as a point in a 999-dimensional simplex.

---

## Generalized HSL

For `X` normalized channels:

### Maximum and minimum

[
C_{\max}=\max_i(C_i)
]

[
C_{\min}=\min_i(C_i)
]

[
\Delta=C_{\max}-C_{\min}
]

### Lightness

[
L=\frac{C_{\max}+C_{\min}}2
]

### Saturation

[
S=
\begin{cases}
0,&\Delta=0[4pt]
\dfrac{\Delta}{1-|2L-1|},&\Delta\neq0
\end{cases}
]

### Chromatic component

The neutral component is removed using the mean:

[
\bar C=\frac1X\sum_{i=1}^{X}C_i
]

[
q_i=C_i-\bar C
]

Since:

[
\sum_i q_i=0
]

the chromatic vector lies in an (X-1)-dimensional space.

A direction in that space requires:

[
X-2
]

angular coordinates.

Therefore:

[
H=(H_1,H_2,\ldots,H_{X-2})
]

For 1000 channels:

[
H=(H_1,\ldots,H_{998})
]

---

# Why "Hyperwheel"?

The term combines two ideas.

**Hyper-**

The system operates in a very high-dimensional space. With approximately 1000 semantic channels, the corresponding simplex has 999 dimensions.

**Wheel**

The base channels are deliberately ordered. Their order defines the orientation of the system and provides a cyclic structure analogous to the ordering of primary colors around a color wheel.

The project therefore investigates whether a high-dimensional cyclic structure can provide a useful coordinate system for cinematic experience.

---

# Similarity vs. harmony

The central motivation is not to find movies that are simply similar.

Consider:

```text
Blade Runner
Mimino
```

A viewer may rate both films very highly without the two films being particularly similar or harmonious.

High preference for two movies does not establish a movie-to-movie relationship.

Cinematic-Hyperwheel instead investigates a different question:

> Given a movie I enjoyed, what other movie can continue the experience while being genuinely different?

In other words:

```text
A
│
│  "continue the experience"
│
▼
B
```

rather than:

```text
A
│
│  "find something similar"
│
▼
A'
```

The desired relationship can be described informally as:

> **different, but consonant**

or:

> **another point in the cinematic space that preserves something about the experience of the original point.**

---

# Important distinction

Three different relationships must not be confused.

### Similarity

```text
A ───────── A'
```

The two movies share many characteristics.

### Preference

```text
User
 ├── A ★★★★★
 └── B ★★★★★
```

The user likes both movies.

This does **not** establish a relationship between A and B.

### Harmony

```text
A ───────── B
      ↘
       different
       experience
```

B is deliberately different from A while preserving some deeper relationship.

Cinematic-Hyperwheel is primarily interested in the third relationship.

---

# Channel ordering

The ordering of base channels is part of the coordinate system.

For RGB:

```python
BASE_CHANNELS = (
    "R",
    "G",
    "B",
)
```

For the cinematic model, the approximately 1000 tags must be assigned a stable order.

The initial approach is to use deterministic alphabetical ordering unless the source dataset provides a demonstrably meaningful and stable ordering.

Changing the ordering changes the coordinate system and therefore must be treated as a meaningful transformation rather than an implementation detail.

---

# API

The core converter accepts a mapping of normalized channels:

```python
from generalized_hsl import to_hsl

result = to_hsl({
    "R": 1.0,
    "G": 0.5,
    "B": 0.0,
})

print(result.H)
print(result.S)
print(result.L)
```

The result is:

```python
HSL(
    H=(...,),
    S=...,
    L=...
)
```

For `X` channels:

```text
H → X - 2 angular coordinates
S → 1 scalar
L → 1 scalar
```

---

# Current mathematical status

Cinematic-Hyperwheel is an **experimental mathematical model**.

The direct generalization of `L` and `S` from RGB is straightforward.

The generalization of `H` is more subtle.

For an arbitrary number of channels, a mathematically correct implementation requires an appropriate coordinate system for a **regular simplex**.

Simply removing one dependent coordinate from the zero-sum chromatic vector does not preserve the Euclidean symmetry of the simplex.

Therefore an important part of the research is constructing an orthonormal basis in which all base channels remain geometrically equivalent.

The intended transformation is:

[
(C_1,\ldots,C_X)
\rightarrow
\text{regular simplex coordinates}
\rightarrow
(H_1,\ldots,H_{X-2})
]

---

# Research roadmap

## Phase 1 — Mathematical model

* [ ] Construct an orthonormal basis for a regular (X)-vertex simplex.
* [ ] Implement the generalized chromatic coordinate system.
* [ ] Implement hyperspherical angular coordinates.
* [ ] Verify the (X=3) case against conventional RGB → HSL.
* [ ] Verify symmetry under channel permutations.
* [ ] Define behaviour for zero-chroma points.

## Phase 2 — Cinematic data

* [ ] Load `tag_genome.csv`.
* [ ] Identify the complete stable set of tags.
* [ ] Establish deterministic tag ordering.
* [ ] Build movie → 1000-channel vectors.
* [ ] Convert movies to generalized HSL.
* [ ] Explore the resulting geometry.

## Phase 3 — Geometry

Investigate:

* angular distance;
* similarity distance;
* relationships between H, S and L;
* clusters;
* neighbourhoods;
* trajectories between movies;
* effects of channel ordering;
* invariance under transformations.

## Phase 4 — Harmony

Compare the geometric model against independent sources:

* curated movie lists;
* explicit movie-to-movie recommendations;
* sequential viewing data;
* conventional similarity algorithms;
* MovieLens data;
* manually collected examples of "different but harmonious" films.

The central hypothesis is:

> **A useful recommendation does not necessarily lie close to the source movie. It may occupy a different region of the cinematic space while preserving a meaningful structural relationship with it.**

---

# Project structure

```text
Cinematic-Hyperwheel/
│
├── README.md
├── generalized_hsl.py
│
├── tests/
│   ├── test_hsl.py
│   └── ...
│
├── data/
│   └── ...
│
└── experiments/
    └── ...
```

---

# Requirements

Python 3.10+.

The core mathematical implementation is intended to use only the Python standard library initially.

Additional numerical libraries may be introduced during experimentation if they provide a clear benefit.

---

## Data sources

### Tag Genome

Cinematic-Hyperwheel uses the **Tag Genome Dataset** released by the GroupLens Research Group at the University of Minnesota.

The Tag Genome represents each movie by its relevance to a common set of semantic tags. The dataset contains relevance values for **9,734 movies and 1,128 tags**, with each relevance value represented on a continuous scale from 0 to 1.

This makes the dataset a natural starting point for representing movies as points in a high-dimensional semantic space.

* **Dataset:** [Tag Genome — GroupLens](https://grouplens.org/datasets/tag-genome/)
* **Download and usage terms:** [Tag Genome README](https://files.grouplens.org/datasets/tag-genome/)
* **Original paper:** Jesse Vig, Shilad Sen, John Riedl. *The Tag Genome: Encoding Community Knowledge to Support Novel Interaction*. ACM Transactions on Interactive Intelligent Systems, 2012.
* **DOI:** 10.1145/2362394.2362395

The dataset is used in accordance with the usage terms specified by GroupLens. The dataset itself is not redistributed with this repository; users should obtain it directly from the official GroupLens source.

### Citation

If you use this project with the Tag Genome dataset, please also cite the original Tag Genome work:

> Vig, Jesse; Sen, Shilad; Riedl, John. (2012). The Tag Genome: Encoding Community Knowledge to Support Novel Interaction. ACM Transactions on Interactive Intelligent Systems, 2(3), 13:1–13:44. https://doi.org/10.1145/2362394.2362395

---

# License

TBD.
