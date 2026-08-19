import csv

def check_csv_sequence(file_path):
    with open(file_path, mode='r', encoding='utf-8') as f:
        reader = csv.reader(f)

        # skip header
        next(reader)
        
        expected = 1
        line_num = 0
        
        for row in reader:
            line_num += 1
            if not row or len(row) < 2:
                print(f"Line {line_num}: missing or empty.")
                return False
            
            try:
                val = int(row[1])  # column B
            except ValueError:
                print(f"Line {line_num}: value '{row[1]}' is not a number.")
                return False
            
            if val != expected:
                print(f"Error in line {line_num}: Expected {expected}, found {val}.")
                return False
            
            expected = 1 if expected == 1128 else expected + 1
            
        if expected != 1:
            print(f"Error: Unexpected end of file. Expected {expected}.")
            return False
            
        print("Success! All lines go strictly from 1 to 1128 sequentially.")
        return True

check_csv_sequence('data/ml-latest/ml-latest/genome-scores.csv')