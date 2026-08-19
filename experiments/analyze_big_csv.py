import csv

unique_movieId = set()

with open('data/ml-latest/ml-latest/genome-scores.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)

    next(reader, None) 
    
    for row in reader:
        if row:
            unique_movieId.add(row[0])

print(f"Unique movies: {len(unique_movieId)}")
