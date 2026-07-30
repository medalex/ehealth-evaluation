#!/usr/bin/env python3
"""Turn results/*.csv into IEEE single-column figures (PDF/EPS) in figures/.

Usage:  python notebooks/plots.py
Deps:   pip install pandas matplotlib

Kept as a plain script (not .ipynb) so reviewers can run it non-interactively and diff it.
Aggregation (median/p95) is done HERE, from the raw per-run CSV rows, so the derivation is
transparent and re-runnable.
"""
import os
import pandas as pd
import matplotlib.pyplot as plt

HERE = os.path.dirname(__file__)
RESULTS = os.path.join(HERE, "..", "results")
FIGURES = os.path.join(HERE, "..", "figures")
os.makedirs(FIGURES, exist_ok=True)

# IEEE single-column friendly defaults.
plt.rcParams.update({"figure.figsize": (3.4, 2.4), "font.size": 8, "savefig.bbox": "tight"})


def save(fig, name):
    for ext in ("pdf", "eps"):
        fig.savefig(os.path.join(FIGURES, f"{name}.{ext}"))
    plt.close(fig)


def plot_gas():
    path = os.path.join(RESULTS, "gas.csv")
    if not os.path.exists(path):
        print("skip gas: no gas.csv")
        return
    df = pd.read_csv(path)
    agg = df.groupby("op")["gasUsed"].median().sort_values()
    fig, ax = plt.subplots()
    ax.barh(agg.index, agg.values)
    ax.set_xlabel("gas (median)")
    ax.set_title("On-chain gas by operation")
    save(fig, "gas_by_op")
    print("wrote figures/gas_by_op.{pdf,eps}")


def plot_zkp():
    path = os.path.join(RESULTS, "zkp-scaling.csv")
    if not os.path.exists(path):
        print("skip zkp: no zkp-scaling.csv")
        return
    df = pd.read_csv(path)
    fig, ax = plt.subplots()
    ax.plot(df["constraints"], df["proveMs"], marker="o")
    ax.set_xlabel("R1CS constraints")
    ax.set_ylabel("proof-gen (ms)")
    ax.set_title("ZKP proof time vs circuit size")
    save(fig, "zkp_prove_vs_constraints")
    print("wrote figures/zkp_prove_vs_constraints.{pdf,eps}")


if __name__ == "__main__":
    plot_gas()
    plot_zkp()
