import numpy as np

data_2021 = np.load('data/genome_2021/artifact.npz', allow_pickle=True)
data_latest = np.load('data/ml-latest/artifact.npz', allow_pickle=True)

files = data_2021.files

items = data_2021['items']
criteria = data_2021['criteria']
x = data_2021['X']

files_latest = data_latest.files

items_latest = data_latest['items']
criteria_latest = data_latest['criteria']
x_latest = data_latest['X']

print(len(data_2021))
print(len(data_latest))